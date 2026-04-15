import ipaddress
import logging
import math
import socket
from urllib.parse import urlparse
from xml.etree import ElementTree

import httpx

logger = logging.getLogger(__name__)

TIMEOUT = 60.0


def _validate_url_not_internal(url: str) -> None:
    """Reject URLs that target localhost, private, or link-local IP ranges (SSRF prevention)."""
    parsed = urlparse(url)
    hostname = parsed.hostname
    if not hostname:
        raise ValueError("URL has no hostname")

    # Reject obvious localhost aliases
    if hostname.lower() in ("localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"):
        raise ValueError(f"Requests to localhost ({hostname}) are not allowed")

    # Resolve hostname and check all resulting IPs
    try:
        addrinfo = socket.getaddrinfo(hostname, None, proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        raise ValueError(f"Cannot resolve hostname: {hostname}")

    for family, _type, _proto, _canonname, sockaddr in addrinfo:
        ip = ipaddress.ip_address(sockaddr[0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
            raise ValueError(
                f"URL resolves to non-public IP address ({ip}). "
                "Requests to private/internal networks are not allowed."
            )


# ArcGIS WKID values that mean Web Mercator (EPSG:3857)
_WEB_MERCATOR_WKIDS = {3857, 102100, 102113, 900913}


def _web_mercator_to_wgs84(x: float, y: float) -> tuple[float, float]:
    """Convert Web Mercator (EPSG:3857) coordinates to WGS84 (EPSG:4326)."""
    lon = x * 180.0 / 20037508.34
    lat = math.atan(math.exp(y * math.pi / 20037508.34)) * 360.0 / math.pi - 90.0
    return lon, lat


def _validate_wgs84_bounds(bounds: list[float] | None) -> list[float] | None:
    """Return bounds only if they represent a reasonable WGS84 extent."""
    if not bounds or len(bounds) != 4:
        return None
    minx, miny, maxx, maxy = bounds
    # Must be valid WGS84 range
    if not (
        -180 <= minx <= 180
        and -90 <= miny <= 90
        and -180 <= maxx <= 180
        and -90 <= maxy <= 90
    ):
        return None
    # Must have non-zero area (min < max)
    if minx >= maxx or miny >= maxy:
        return None
    # Reject full-planet extents (likely a default/placeholder)
    if (maxx - minx) > 350 and (maxy - miny) > 170:
        return None
    return bounds


async def browse_directory(url: str) -> dict:
    """Browse an ArcGIS REST services directory. Returns folders and services.

    Works with root directories (e.g., /arcgis/rest/services/) and
    subdirectories (e.g., /arcgis/rest/services/Geoscientific).
    """
    url = url.strip().rstrip("/")
    _validate_url_not_internal(url)

    async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True) as client:
        resp = await client.get(url, params={"f": "json"})
        resp.raise_for_status()
        data = resp.json()

    folders = data.get("folders", [])
    raw_services = data.get("services", [])

    # Determine the base URL for constructing full service URLs
    # If URL ends with /rest/services or /rest/services/FolderName, the base is up to /rest/services
    base_url = url
    # Walk up to find the /rest/services root
    rest_idx = url.lower().find("/rest/services")
    if rest_idx != -1:
        base_url = url[: rest_idx + len("/rest/services")]

    services = []
    for svc in raw_services:
        svc_name = svc.get("name", "")
        svc_type = svc.get("type", "")
        # Full URL: {base}/ServiceName/ServiceType
        svc_url = f"{base_url}/{svc_name}/{svc_type}"
        # Display name: last part of the name (after folder prefix)
        display_name = svc_name.split("/")[-1] if "/" in svc_name else svc_name
        services.append(
            {
                "name": display_name,
                "full_name": svc_name,
                "type": svc_type,
                "url": svc_url,
            }
        )

    return {
        "url": url,
        "folders": folders,
        "services": services,
    }


async def probe_service(url: str) -> dict:
    """Auto-detect service type from a URL and return available layers.

    Returns dict with keys: service_type, layers, capabilities_url
    """
    url = url.strip().rstrip("/")

    # XYZ/TMS patterns are tile templates — skip SSRF check since they're
    # evaluated client-side and never fetched directly by the server.
    if any(p in url for p in ["{z}", "{x}", "{y}"]):
        return {
            "service_type": "xyz",
            "layers": [
                {
                    "id": "tiles",
                    "name": "Tile Layer",
                    "geometry_type": None,
                    "extent": None,
                }
            ],
            "capabilities_url": url,
            "metadata": None,
        }

    _validate_url_not_internal(url)

    async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True) as client:
        # Try ArcGIS REST
        result = await _try_arcgis(client, url)
        if result:
            return result

        # Try WFS
        result = await _try_wfs(client, url)
        if result:
            return result

        # Try WMS
        result = await _try_wms(client, url)
        if result:
            return result

    raise ValueError(
        "Could not detect service type. Supported: ArcGIS REST, WFS, WMS, XYZ/TMS"
    )


async def _try_arcgis(client: httpx.AsyncClient, url: str) -> dict | None:
    """Try to detect ArcGIS REST service."""
    try:
        resp = await client.get(url, params={"f": "json"})
        if resp.status_code != 200:
            return None
        data = resp.json()

        # ImageServer detection (check before MapServer/FeatureServer)
        if "ImageServer" in url and (
            "serviceDataType" in data or "bandCount" in data or "pixelSizeX" in data
        ):
            extent = _arcgis_extent(data.get("fullExtent") or data.get("extent"))
            metadata = _extract_arcgis_metadata(data)
            return {
                "service_type": "arcgis_image",
                "layers": [
                    {
                        "id": "0",
                        "name": data.get(
                            "name",
                            data.get("serviceDescription", "Image Service")[:80]
                            or "Image Service",
                        ),
                        "geometry_type": None,
                        "extent": extent,
                    }
                ],
                "capabilities_url": f"{url}?f=json",
                "metadata": metadata,
            }

        # FeatureServer or MapServer
        if "layers" in data:
            layers = []
            if "FeatureServer" in url:
                service_type = "arcgis_feature"
            elif "MapServer" in url:
                # Check if the MapServer has a tile cache
                has_tile_cache = data.get("singleFusedMapCache", False)
                service_type = "arcgis_map" if has_tile_cache else "arcgis_map_export"
            else:
                service_type = "arcgis_map_export"

            for layer in data.get("layers", []):
                # Skip group layers (containers with sub-layers)
                if layer.get("subLayerIds"):
                    continue
                layers.append(
                    {
                        "id": str(layer.get("id", 0)),
                        "name": layer.get("name", "Layer"),
                        "geometry_type": layer.get("geometryType"),
                        "extent": _arcgis_extent(
                            data.get("fullExtent") or data.get("initialExtent")
                        ),
                    }
                )

            if layers:
                metadata = _extract_arcgis_metadata(data)
                return {
                    "service_type": service_type,
                    "layers": layers,
                    "capabilities_url": f"{url}?f=json",
                    "metadata": metadata,
                }

        # Single layer endpoint (e.g., .../FeatureServer/0)
        if "type" in data and "fields" in data:
            metadata = _extract_arcgis_metadata(data)
            return {
                "service_type": "arcgis_feature",
                "layers": [
                    {
                        "id": str(data.get("id", 0)),
                        "name": data.get("name", "Layer"),
                        "geometry_type": data.get("geometryType"),
                        "extent": _arcgis_extent(data.get("extent")),
                    }
                ],
                "capabilities_url": f"{url}?f=json",
                "metadata": metadata,
            }
    except (httpx.HTTPError, ValueError, KeyError):
        pass
    return None


def _extract_arcgis_metadata(data: dict) -> dict:
    """Extract common metadata fields from an ArcGIS REST JSON response."""
    metadata = {}
    for key in (
        "description",
        "serviceDescription",
        "copyrightText",
        "credits",
        "capabilities",
        "currentVersion",
    ):
        val = data.get(key)
        if val:
            metadata[key] = val
    return metadata


def _arcgis_extent(extent: dict | None) -> list[float] | None:
    """Extract and reproject ArcGIS extent to WGS84 [minx, miny, maxx, maxy]."""
    if not extent:
        return None
    try:
        xmin, ymin = extent["xmin"], extent["ymin"]
        xmax, ymax = extent["xmax"], extent["ymax"]
    except (KeyError, TypeError):
        return None

    # Check spatial reference — reproject if not WGS84
    sr = extent.get("spatialReference") or {}
    wkid = sr.get("latestWkid") or sr.get("wkid")
    if wkid and wkid in _WEB_MERCATOR_WKIDS:
        xmin, ymin = _web_mercator_to_wgs84(xmin, ymin)
        xmax, ymax = _web_mercator_to_wgs84(xmax, ymax)
    elif wkid and wkid != 4326:
        # Unknown projection — try pyproj if available
        try:
            from pyproj import Transformer

            transformer = Transformer.from_crs(
                f"EPSG:{wkid}", "EPSG:4326", always_xy=True
            )
            xmin, ymin = transformer.transform(xmin, ymin)
            xmax, ymax = transformer.transform(xmax, ymax)
        except Exception:
            logger.warning("Cannot reproject extent from WKID %s to WGS84", wkid)
            return None

    return _validate_wgs84_bounds([xmin, ymin, xmax, ymax])


async def fetch_arcgis_layer_extent(
    service_url: str, layer_id: str
) -> list[float] | None:
    """Fetch extent for a specific ArcGIS layer by querying its individual endpoint."""
    url = f"{service_url.rstrip('/')}/{layer_id}"
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True) as client:
            resp = await client.get(url, params={"f": "json"})
            if resp.status_code == 200:
                data = resp.json()
                return _arcgis_extent(data.get("extent"))
    except (httpx.HTTPError, ValueError, KeyError):
        logger.debug("Failed to fetch layer extent for %s/%s", service_url, layer_id)
    return None


async def fetch_arcgis_feature_count(service_url: str, layer_id: str) -> int | None:
    """Query an ArcGIS FeatureServer for its total feature count."""
    url = f"{service_url.rstrip('/')}/{layer_id}/query"
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True) as client:
            resp = await client.get(
                url, params={"f": "json", "where": "1=1", "returnCountOnly": "true"}
            )
            if resp.status_code == 200:
                return resp.json().get("count")
    except (httpx.HTTPError, ValueError, KeyError):
        logger.debug("Failed to fetch feature count for %s/%s", service_url, layer_id)
    return None


def suggest_min_zoom(feature_count: int | None) -> int:
    """Suggest a min_zoom level based on feature count to avoid overloading tile queries."""
    if not feature_count or feature_count < 5000:
        return 0
    if feature_count < 50000:
        return 8
    if feature_count < 200000:
        return 10
    return 12


async def _try_wfs(client: httpx.AsyncClient, url: str) -> dict | None:
    """Try to detect WFS service."""
    try:
        resp = await client.get(
            url,
            params={
                "service": "WFS",
                "request": "GetCapabilities",
            },
        )
        if resp.status_code != 200:
            return None
        text = resp.text
        if "WFS_Capabilities" not in text and "wfs:WFS_Capabilities" not in text:
            return None

        root = ElementTree.fromstring(text)
        ns = _detect_ns(root, "wfs")

        layers = []
        for ft in root.iter(f"{ns}FeatureType"):
            name_el = ft.find(f"{ns}Name")
            title_el = ft.find(f"{ns}Title")
            if name_el is not None and name_el.text:
                layers.append(
                    {
                        "id": name_el.text,
                        "name": (
                            title_el.text
                            if title_el is not None and title_el.text
                            else name_el.text
                        ),
                        "geometry_type": None,
                        "extent": _wfs_extent(ft, ns),
                    }
                )

        if layers:
            metadata = {}
            # Extract service-level metadata from capabilities
            for tag_name in ("Abstract", "AccessConstraints"):
                for prefix in (
                    ns,
                    "{http://www.opengis.net/ows}",
                    "{http://www.opengis.net/ows/1.1}",
                    "",
                ):
                    el = root.find(f".//{prefix}{tag_name}")
                    if el is not None and el.text:
                        metadata[tag_name] = el.text
                        break
            return {
                "service_type": "wfs",
                "layers": layers,
                "capabilities_url": f"{url}?service=WFS&request=GetCapabilities",
                "metadata": metadata or None,
            }
    except (httpx.HTTPError, ElementTree.ParseError):
        pass
    return None


async def _try_wms(client: httpx.AsyncClient, url: str) -> dict | None:
    """Try to detect WMS service."""
    try:
        resp = await client.get(
            url,
            params={
                "service": "WMS",
                "request": "GetCapabilities",
            },
        )
        if resp.status_code != 200:
            return None
        text = resp.text
        if "WMS_Capabilities" not in text and "WMT_MS_Capabilities" not in text:
            return None

        root = ElementTree.fromstring(text)
        ns = _detect_ns(root, "wms")

        layers = []
        # Find named layers (skip container layers without names)
        for layer_el in root.iter(f"{ns}Layer"):
            name_el = layer_el.find(f"{ns}Name")
            title_el = layer_el.find(f"{ns}Title")
            if name_el is not None and name_el.text:
                layers.append(
                    {
                        "id": name_el.text,
                        "name": (
                            title_el.text
                            if title_el is not None and title_el.text
                            else name_el.text
                        ),
                        "geometry_type": None,
                        "extent": _wms_extent(layer_el, ns),
                    }
                )

        if layers:
            metadata = {}
            # Extract service-level Abstract from capabilities
            service_el = root.find(f"{ns}Service")
            if service_el is not None:
                abstract_el = service_el.find(f"{ns}Abstract")
                if abstract_el is not None and abstract_el.text:
                    metadata["Abstract"] = abstract_el.text
            return {
                "service_type": "wms",
                "layers": layers,
                "capabilities_url": f"{url}?service=WMS&request=GetCapabilities",
                "metadata": metadata or None,
            }
    except (httpx.HTTPError, ElementTree.ParseError):
        pass
    return None


def _detect_ns(root: ElementTree.Element, service: str) -> str:
    """Extract namespace from root element tag."""
    tag = root.tag
    if "{" in tag:
        return tag.split("}")[0] + "}"
    return ""


def _wfs_extent(ft_el: ElementTree.Element, ns: str) -> list[float] | None:
    """Extract bounding box from a WFS FeatureType element."""
    for bbox_tag in [
        f"{ns}WGS84BoundingBox",
        "{http://www.opengis.net/ows}WGS84BoundingBox",
        "{http://www.opengis.net/ows/1.1}WGS84BoundingBox",
    ]:
        bbox = ft_el.find(bbox_tag)
        if bbox is not None:
            lower = bbox.find(f"{bbox_tag.rsplit('}', 1)[0] + '}'}LowerCorner")
            upper = bbox.find(f"{bbox_tag.rsplit('}', 1)[0] + '}'}UpperCorner")
            if lower is None:
                # Try without namespace
                lower = bbox.find("LowerCorner")
                upper = bbox.find("UpperCorner")
            if lower is not None and upper is not None and lower.text and upper.text:
                try:
                    lc = lower.text.split()
                    uc = upper.text.split()
                    return _validate_wgs84_bounds(
                        [float(lc[0]), float(lc[1]), float(uc[0]), float(uc[1])]
                    )
                except (ValueError, IndexError):
                    pass
    return None


def _wms_extent(layer_el: ElementTree.Element, ns: str) -> list[float] | None:
    """Extract bounding box from a WMS Layer element."""
    bbox = layer_el.find(f"{ns}EX_GeographicBoundingBox")
    if bbox is not None:
        try:
            west = float(bbox.findtext(f"{ns}westBoundLongitude") or "")
            east = float(bbox.findtext(f"{ns}eastBoundLongitude") or "")
            south = float(bbox.findtext(f"{ns}southBoundLatitude") or "")
            north = float(bbox.findtext(f"{ns}northBoundLatitude") or "")
            return _validate_wgs84_bounds([west, south, east, north])
        except ValueError:
            pass
    # Fallback: LatLonBoundingBox (WMS 1.1.1)
    bbox = layer_el.find("LatLonBoundingBox")
    if bbox is not None:
        try:
            return _validate_wgs84_bounds(
                [
                    float(bbox.get("minx", "")),
                    float(bbox.get("miny", "")),
                    float(bbox.get("maxx", "")),
                    float(bbox.get("maxy", "")),
                ]
            )
        except ValueError:
            pass
    return None


async def fetch_all_features(
    service_url: str,
    service_type: str,
    layer_id: str,
    max_features: int = 10000,
    timeout: float = TIMEOUT,
) -> dict:
    """Fetch all features from an external vector service with pagination.

    Automatically reduces page size on server errors (some services fail
    with large geometry payloads).

    Returns a GeoJSON FeatureCollection dict.
    """
    _validate_url_not_internal(service_url)
    all_features: list[dict] = []
    page_size = 2000

    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        if service_type == "arcgis_feature":
            offset = 0
            query_url = f"{service_url.rstrip('/')}/{layer_id}/query"

            retries = 0
            max_retries = 3

            while len(all_features) < max_features:
                remaining = min(page_size, max_features - len(all_features))
                params = {
                    "f": "geojson",
                    "where": "1=1",
                    "outFields": "*",
                    "outSR": "4326",
                    "resultRecordCount": str(remaining),
                    "resultOffset": str(offset),
                }

                # Handle both HTTP errors and timeouts
                try:
                    resp = await client.get(query_url, params=params)
                except httpx.TimeoutException:
                    retries += 1
                    if retries <= max_retries:
                        if page_size > 10:
                            page_size = max(page_size // 2, 10)
                        logger.info(
                            "Timeout at offset %s, retry %s/%s (page_size=%s)",
                            offset,
                            retries,
                            max_retries,
                            page_size,
                        )
                        continue
                    logger.warning(
                        "Max retries reached after timeout, returning %s features",
                        len(all_features),
                    )
                    break

                # If server errors, reduce page size and retry
                is_error = resp.status_code != 200
                data = None
                if not is_error:
                    try:
                        data = resp.json()
                    except ValueError:
                        is_error = True
                    else:
                        if data.get("error"):
                            is_error = True

                if is_error:
                    if page_size > 10:
                        page_size = max(page_size // 4, 10)
                        logger.info(
                            "Server error (status=%s), reducing page size to %s",
                            resp.status_code,
                            page_size,
                        )
                        continue
                    retries += 1
                    if retries <= max_retries:
                        logger.info(
                            "Retry %s/%s at page_size=%s",
                            retries,
                            max_retries,
                            page_size,
                        )
                        continue
                    logger.warning(
                        "Server errors persist at page_size=%s, returning %s features",
                        page_size,
                        len(all_features),
                    )
                    break

                retries = 0  # Reset on success

                features = data.get("features", [])
                if not features:
                    break
                all_features.extend(features)
                logger.debug(
                    "Fetched %d features (total: %d, page_size: %d)",
                    len(features),
                    len(all_features),
                    page_size,
                )
                # If we got fewer than requested, we've reached the end
                if len(features) < remaining:
                    break
                offset += len(features)

        elif service_type == "wfs":
            start_index = 0
            while len(all_features) < max_features:
                remaining = min(page_size, max_features - len(all_features))
                params = {
                    "service": "WFS",
                    "request": "GetFeature",
                    "typeName": layer_id,
                    "outputFormat": "application/json",
                    "srsName": "EPSG:4326",
                    "maxFeatures": str(remaining),
                    "startIndex": str(start_index),
                }
                resp = await client.get(service_url, params=params)
                if resp.status_code != 200:
                    break
                data = resp.json()
                features = data.get("features", [])
                if not features:
                    break
                all_features.extend(features)
                if len(features) < remaining:
                    break
                start_index += len(features)
        else:
            raise ValueError(f"Cannot fetch features for service type: {service_type}")

    return {
        "type": "FeatureCollection",
        "features": all_features,
    }


_PROXY_CLIENT: httpx.AsyncClient | None = None


def _get_proxy_client() -> httpx.AsyncClient:
    """Lazily construct the shared AsyncClient used for upstream proxy fetches.

    Reusing a single client enables connection pooling (DNS + TCP + TLS reuse),
    which is critical under bursty tile traffic — one tile per panned viewport
    would otherwise cost a full handshake each.
    """
    global _PROXY_CLIENT
    if _PROXY_CLIENT is None:
        _PROXY_CLIENT = httpx.AsyncClient(
            timeout=TIMEOUT,
            follow_redirects=True,
            limits=httpx.Limits(max_connections=100, max_keepalive_connections=20),
        )
    return _PROXY_CLIENT


async def close_proxy_client() -> None:
    """Close the shared proxy client on app shutdown."""
    global _PROXY_CLIENT
    if _PROXY_CLIENT is not None:
        await _PROXY_CLIENT.aclose()
        _PROXY_CLIENT = None


async def proxy_request(
    service_url: str,
    service_type: str,
    params: dict,
) -> httpx.Response:
    """Proxy a request to an external service.

    Validates the target URL against SSRF rules, then opportunistically
    attempts an https:// upgrade if the registered URL is plain http. Falls
    back to the original scheme only if the https attempt fails.
    """
    _validate_url_not_internal(service_url)
    client = _get_proxy_client()

    target = service_url
    upgraded: str | None = None
    if target.startswith("http://"):
        upgraded = "https://" + target[len("http://") :]

    if upgraded is not None:
        try:
            resp = await client.get(upgraded, params=params)
            resp.raise_for_status()
            return resp
        except (httpx.HTTPError, httpx.InvalidURL):
            logger.info(
                "https upgrade of upstream failed, falling back to http: %s", service_url
            )

    resp = await client.get(target, params=params)
    resp.raise_for_status()
    return resp
