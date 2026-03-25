import logging
from xml.etree import ElementTree

import httpx

logger = logging.getLogger(__name__)

TIMEOUT = 15.0


async def browse_directory(url: str) -> dict:
    """Browse an ArcGIS REST services directory. Returns folders and services.

    Works with root directories (e.g., /arcgis/rest/services/) and
    subdirectories (e.g., /arcgis/rest/services/Geoscientific).
    """
    url = url.strip().rstrip("/")

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
        base_url = url[:rest_idx + len("/rest/services")]

    services = []
    for svc in raw_services:
        svc_name = svc.get("name", "")
        svc_type = svc.get("type", "")
        # Full URL: {base}/ServiceName/ServiceType
        svc_url = f"{base_url}/{svc_name}/{svc_type}"
        # Display name: last part of the name (after folder prefix)
        display_name = svc_name.split("/")[-1] if "/" in svc_name else svc_name
        services.append({
            "name": display_name,
            "full_name": svc_name,
            "type": svc_type,
            "url": svc_url,
        })

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

    async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True) as client:
        # Check for XYZ/TMS pattern
        if any(p in url for p in ["{z}", "{x}", "{y}"]):
            return {
                "service_type": "xyz",
                "layers": [{"id": "tiles", "name": "Tile Layer", "geometry_type": None, "extent": None}],
                "capabilities_url": url,
            }

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

        # FeatureServer or MapServer
        if "layers" in data:
            layers = []
            service_type = "arcgis_map"
            if "FeatureServer" in url:
                service_type = "arcgis_feature"
            elif "MapServer" in url:
                service_type = "arcgis_map"

            for layer in data.get("layers", []):
                layers.append({
                    "id": str(layer.get("id", 0)),
                    "name": layer.get("name", "Layer"),
                    "geometry_type": layer.get("geometryType"),
                    "extent": _arcgis_extent(data.get("fullExtent") or data.get("initialExtent")),
                })

            if layers:
                return {
                    "service_type": service_type,
                    "layers": layers,
                    "capabilities_url": f"{url}?f=json",
                }

        # Single layer endpoint (e.g., .../FeatureServer/0)
        if "type" in data and "fields" in data:
            return {
                "service_type": "arcgis_feature",
                "layers": [{
                    "id": str(data.get("id", 0)),
                    "name": data.get("name", "Layer"),
                    "geometry_type": data.get("geometryType"),
                    "extent": _arcgis_extent(data.get("extent")),
                }],
                "capabilities_url": f"{url}?f=json",
            }
    except (httpx.HTTPError, ValueError, KeyError):
        pass
    return None


def _arcgis_extent(extent: dict | None) -> list[float] | None:
    if not extent:
        return None
    try:
        return [extent["xmin"], extent["ymin"], extent["xmax"], extent["ymax"]]
    except (KeyError, TypeError):
        return None


async def _try_wfs(client: httpx.AsyncClient, url: str) -> dict | None:
    """Try to detect WFS service."""
    try:
        resp = await client.get(url, params={
            "service": "WFS",
            "request": "GetCapabilities",
        })
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
                layers.append({
                    "id": name_el.text,
                    "name": (title_el.text if title_el is not None and title_el.text else name_el.text),
                    "geometry_type": None,
                    "extent": _wfs_extent(ft, ns),
                })

        if layers:
            return {
                "service_type": "wfs",
                "layers": layers,
                "capabilities_url": f"{url}?service=WFS&request=GetCapabilities",
            }
    except (httpx.HTTPError, ElementTree.ParseError):
        pass
    return None


async def _try_wms(client: httpx.AsyncClient, url: str) -> dict | None:
    """Try to detect WMS service."""
    try:
        resp = await client.get(url, params={
            "service": "WMS",
            "request": "GetCapabilities",
        })
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
                layers.append({
                    "id": name_el.text,
                    "name": (title_el.text if title_el is not None and title_el.text else name_el.text),
                    "geometry_type": None,
                    "extent": _wms_extent(layer_el, ns),
                })

        if layers:
            return {
                "service_type": "wms",
                "layers": layers,
                "capabilities_url": f"{url}?service=WMS&request=GetCapabilities",
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
    for bbox_tag in [f"{ns}WGS84BoundingBox", "{http://www.opengis.net/ows}WGS84BoundingBox",
                     "{http://www.opengis.net/ows/1.1}WGS84BoundingBox"]:
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
                    return [float(lc[0]), float(lc[1]), float(uc[0]), float(uc[1])]
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
            return [west, south, east, north]
        except ValueError:
            pass
    # Fallback: LatLonBoundingBox (WMS 1.1.1)
    bbox = layer_el.find("LatLonBoundingBox")
    if bbox is not None:
        try:
            return [
                float(bbox.get("minx", "")),
                float(bbox.get("miny", "")),
                float(bbox.get("maxx", "")),
                float(bbox.get("maxy", "")),
            ]
        except ValueError:
            pass
    return None


async def proxy_request(
    service_url: str,
    service_type: str,
    params: dict,
) -> httpx.Response:
    """Proxy a request to an external service."""
    async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True) as client:
        resp = await client.get(service_url, params=params)
        resp.raise_for_status()
        return resp
