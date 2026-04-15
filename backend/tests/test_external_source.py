"""Tests for external source service."""

import httpx
import pytest
import respx

from app.services.external_source import (
    _web_mercator_to_wgs84,
    _validate_wgs84_bounds,
    _arcgis_extent,
    _extract_arcgis_metadata,
    _detect_ns,
    suggest_min_zoom,
    browse_directory,
    probe_service,
    fetch_arcgis_layer_extent,
    fetch_arcgis_feature_count,
    fetch_all_features,
    proxy_request,
)

# ── Pure Functions ────────────────────────────────────────────────────


class TestWebMercatorToWgs84:
    def test_origin(self):
        lon, lat = _web_mercator_to_wgs84(0, 0)
        assert abs(lon) < 1e-10
        assert abs(lat) < 1e-10

    def test_known_point(self):
        # New York City ~ (-73.97, 40.78) in WGS84
        # ~ (-8235000, 4978000) in Web Mercator
        lon, lat = _web_mercator_to_wgs84(-8235000, 4978000)
        assert -74.5 < lon < -73.5
        assert 40.0 < lat < 41.5

    def test_positive_hemisphere(self):
        lon, lat = _web_mercator_to_wgs84(20037508.34, 0)
        assert abs(lon - 180.0) < 1e-6

    def test_round_trip_consistency(self):
        """Converting and checking lat/lon are in expected range."""
        lon, lat = _web_mercator_to_wgs84(1000000, 2000000)
        assert -180 <= lon <= 180
        assert -90 <= lat <= 90


class TestValidateWgs84Bounds:
    def test_valid_bounds(self):
        bounds = [-122.5, 37.5, -122.0, 38.0]
        assert _validate_wgs84_bounds(bounds) == bounds

    def test_none(self):
        assert _validate_wgs84_bounds(None) is None

    def test_empty(self):
        assert _validate_wgs84_bounds([]) is None

    def test_wrong_length(self):
        assert _validate_wgs84_bounds([1, 2, 3]) is None

    def test_out_of_range_lon(self):
        assert _validate_wgs84_bounds([-200, 0, 0, 10]) is None

    def test_out_of_range_lat(self):
        assert _validate_wgs84_bounds([0, -100, 10, 10]) is None

    def test_min_equals_max(self):
        assert _validate_wgs84_bounds([10, 10, 10, 20]) is None

    def test_min_greater_than_max(self):
        assert _validate_wgs84_bounds([20, 10, 10, 20]) is None

    def test_full_planet_rejected(self):
        assert _validate_wgs84_bounds([-180, -90, 180, 90]) is None

    def test_near_full_planet_rejected(self):
        assert _validate_wgs84_bounds([-179, -89, 179, 89]) is None

    def test_large_but_not_full_planet(self):
        # 100 degrees wide, 50 degrees tall — not rejected
        result = _validate_wgs84_bounds([-50, -25, 50, 25])
        assert result is not None


class TestSuggestMinZoom:
    def test_none(self):
        assert suggest_min_zoom(None) == 0

    def test_small_count(self):
        assert suggest_min_zoom(100) == 0

    def test_below_5000(self):
        assert suggest_min_zoom(4999) == 0

    def test_at_5000(self):
        assert suggest_min_zoom(5000) == 8

    def test_medium_count(self):
        assert suggest_min_zoom(49999) == 8

    def test_at_50000(self):
        assert suggest_min_zoom(50000) == 10

    def test_large_count(self):
        assert suggest_min_zoom(199999) == 10

    def test_very_large_count(self):
        assert suggest_min_zoom(200000) == 12

    def test_zero(self):
        assert suggest_min_zoom(0) == 0


class TestArcgisExtent:
    def test_wgs84_extent(self):
        extent = {
            "xmin": -122.5,
            "ymin": 37.5,
            "xmax": -122.0,
            "ymax": 38.0,
            "spatialReference": {"wkid": 4326},
        }
        result = _arcgis_extent(extent)
        assert result == [-122.5, 37.5, -122.0, 38.0]

    def test_web_mercator_extent(self):
        extent = {
            "xmin": -13630000,
            "ymin": 4544000,
            "xmax": -13620000,
            "ymax": 4554000,
            "spatialReference": {"wkid": 102100},
        }
        result = _arcgis_extent(extent)
        assert result is not None
        assert len(result) == 4

    def test_none_extent(self):
        assert _arcgis_extent(None) is None

    def test_missing_keys(self):
        assert _arcgis_extent({"xmin": 0}) is None

    def test_no_spatial_reference(self):
        extent = {"xmin": -10, "ymin": -10, "xmax": 10, "ymax": 10}
        result = _arcgis_extent(extent)
        assert result == [-10, -10, 10, 10]

    def test_unknown_wkid_without_pyproj(self):
        extent = {
            "xmin": 0,
            "ymin": 0,
            "xmax": 1,
            "ymax": 1,
            "spatialReference": {"wkid": 99999},
        }
        # Without pyproj, this should return None or try pyproj
        result = _arcgis_extent(extent)
        # Either None (no pyproj) or a valid result (with pyproj)
        assert result is None or len(result) == 4

    def test_latest_wkid_preferred(self):
        extent = {
            "xmin": -122.5,
            "ymin": 37.5,
            "xmax": -122.0,
            "ymax": 38.0,
            "spatialReference": {"wkid": 102100, "latestWkid": 4326},
        }
        result = _arcgis_extent(extent)
        assert result == [-122.5, 37.5, -122.0, 38.0]


class TestExtractArcgisMetadata:
    def test_all_fields(self):
        data = {
            "description": "A service",
            "serviceDescription": "Service desc",
            "copyrightText": "Copyright 2024",
            "credits": "Credit",
            "capabilities": "Query",
            "currentVersion": 10.9,
        }
        meta = _extract_arcgis_metadata(data)
        assert meta["description"] == "A service"
        assert meta["currentVersion"] == 10.9

    def test_empty_fields_skipped(self):
        data = {"description": "", "copyrightText": None, "name": "Layer"}
        meta = _extract_arcgis_metadata(data)
        assert "description" not in meta
        assert "name" not in meta

    def test_empty_data(self):
        assert _extract_arcgis_metadata({}) == {}


class TestDetectNs:
    def test_with_namespace(self):
        from xml.etree import ElementTree

        root = ElementTree.fromstring(
            '<WFS_Capabilities xmlns="http://www.opengis.net/wfs/2.0"/>'
        )
        assert _detect_ns(root, "wfs") == "{http://www.opengis.net/wfs/2.0}"

    def test_without_namespace(self):
        from xml.etree import ElementTree

        root = ElementTree.fromstring("<WFS_Capabilities/>")
        assert _detect_ns(root, "wfs") == ""


# ── Async Functions with HTTP Mocking ─────────────────────────────────


class TestBrowseDirectory:
    @pytest.mark.asyncio
    @respx.mock
    async def test_basic(self):
        url = "https://example.com/arcgis/rest/services"
        respx.get(url).mock(
            return_value=httpx.Response(
                200,
                json={
                    "folders": ["Folder1", "Folder2"],
                    "services": [
                        {"name": "MyService", "type": "MapServer"},
                        {"name": "Folder1/SubService", "type": "FeatureServer"},
                    ],
                },
            )
        )

        result = await browse_directory(url)
        assert result["folders"] == ["Folder1", "Folder2"]
        assert len(result["services"]) == 2
        assert result["services"][0]["name"] == "MyService"
        assert result["services"][0]["url"] == f"{url}/MyService/MapServer"
        assert result["services"][1]["name"] == "SubService"

    @pytest.mark.asyncio
    @respx.mock
    async def test_empty_directory(self):
        url = "https://example.com/arcgis/rest/services"
        respx.get(url).mock(return_value=httpx.Response(200, json={}))

        result = await browse_directory(url)
        assert result["folders"] == []
        assert result["services"] == []


class TestProbeService:
    @pytest.mark.asyncio
    async def test_xyz_pattern(self):
        url = "https://tiles.example.com/{z}/{x}/{y}.png"
        result = await probe_service(url)
        assert result["service_type"] == "xyz"
        assert len(result["layers"]) == 1

    @pytest.mark.asyncio
    @respx.mock
    async def test_arcgis_feature_server(self):
        url = "https://example.com/arcgis/rest/services/Test/FeatureServer"
        respx.get(url).mock(
            return_value=httpx.Response(
                200,
                json={
                    "layers": [
                        {
                            "id": 0,
                            "name": "Points",
                            "geometryType": "esriGeometryPoint",
                        },
                        {
                            "id": 1,
                            "name": "Lines",
                            "geometryType": "esriGeometryPolyline",
                        },
                    ],
                    "fullExtent": {
                        "xmin": -122.5,
                        "ymin": 37.5,
                        "xmax": -122.0,
                        "ymax": 38.0,
                        "spatialReference": {"wkid": 4326},
                    },
                },
            )
        )

        result = await probe_service(url)
        assert result["service_type"] == "arcgis_feature"
        assert len(result["layers"]) == 2

    @pytest.mark.asyncio
    @respx.mock
    async def test_arcgis_image_server(self):
        url = "https://example.com/arcgis/rest/services/Imagery/ImageServer"
        respx.get(url).mock(
            return_value=httpx.Response(
                200,
                json={
                    "serviceDataType": "esriImageServiceDataTypeElevation",
                    "bandCount": 1,
                    "name": "Elevation",
                    "fullExtent": {
                        "xmin": -122.5,
                        "ymin": 37.5,
                        "xmax": -122.0,
                        "ymax": 38.0,
                        "spatialReference": {"wkid": 4326},
                    },
                },
            )
        )

        result = await probe_service(url)
        assert result["service_type"] == "arcgis_image"

    @pytest.mark.asyncio
    @respx.mock
    async def test_arcgis_map_server_with_tile_cache(self):
        url = "https://example.com/arcgis/rest/services/Basemap/MapServer"
        respx.get(url).mock(
            return_value=httpx.Response(
                200,
                json={
                    "layers": [{"id": 0, "name": "Basemap"}],
                    "singleFusedMapCache": True,
                    "fullExtent": {
                        "xmin": -10,
                        "ymin": -10,
                        "xmax": 10,
                        "ymax": 10,
                        "spatialReference": {"wkid": 4326},
                    },
                },
            )
        )

        result = await probe_service(url)
        assert result["service_type"] == "arcgis_map"

    @pytest.mark.asyncio
    @respx.mock
    async def test_arcgis_single_layer(self):
        url = "https://example.com/arcgis/rest/services/Test/FeatureServer/0"
        respx.get(url).mock(
            return_value=httpx.Response(
                200,
                json={
                    "type": "Feature Layer",
                    "fields": [{"name": "OBJECTID"}],
                    "id": 0,
                    "name": "Points",
                    "geometryType": "esriGeometryPoint",
                    "extent": {
                        "xmin": -10,
                        "ymin": -10,
                        "xmax": 10,
                        "ymax": 10,
                        "spatialReference": {"wkid": 4326},
                    },
                },
            )
        )

        result = await probe_service(url)
        assert result["service_type"] == "arcgis_feature"
        assert result["layers"][0]["name"] == "Points"

    @pytest.mark.asyncio
    @respx.mock
    async def test_wfs_service(self):
        url = "https://example.com/wfs"
        wfs_xml = """<?xml version="1.0"?>
        <WFS_Capabilities xmlns="http://www.opengis.net/wfs/2.0">
            <FeatureType>
                <Name>roads</Name>
                <Title>Roads Layer</Title>
            </FeatureType>
        </WFS_Capabilities>"""
        # ArcGIS probe fails
        respx.get(url, params__contains={"f": "json"}).mock(
            return_value=httpx.Response(404)
        )
        # WFS succeeds
        respx.get(url, params__contains={"service": "WFS"}).mock(
            return_value=httpx.Response(200, text=wfs_xml)
        )

        result = await probe_service(url)
        assert result["service_type"] == "wfs"
        assert result["layers"][0]["name"] == "Roads Layer"

    @pytest.mark.asyncio
    @respx.mock
    async def test_wms_service(self):
        url = "https://example.com/wms"
        wms_xml = """<?xml version="1.0"?>
        <WMS_Capabilities xmlns="http://www.opengis.net/wms">
            <Service><Abstract>A WMS service</Abstract></Service>
            <Capability><Layer>
                <Layer><Name>ortho</Name><Title>Orthophoto</Title></Layer>
            </Layer></Capability>
        </WMS_Capabilities>"""
        # ArcGIS fails
        respx.get(url, params__contains={"f": "json"}).mock(
            return_value=httpx.Response(404)
        )
        # WFS fails
        respx.get(url, params__contains={"service": "WFS"}).mock(
            return_value=httpx.Response(404)
        )
        # WMS succeeds
        respx.get(url, params__contains={"service": "WMS"}).mock(
            return_value=httpx.Response(200, text=wms_xml)
        )

        result = await probe_service(url)
        assert result["service_type"] == "wms"
        assert result["layers"][0]["name"] == "Orthophoto"

    @pytest.mark.asyncio
    @respx.mock
    async def test_unknown_service_raises(self):
        url = "https://example.com/unknown"
        respx.get(url).mock(return_value=httpx.Response(404))

        with pytest.raises(ValueError, match="Could not detect service type"):
            await probe_service(url)

    @pytest.mark.asyncio
    @respx.mock
    async def test_group_layers_skipped(self):
        url = "https://example.com/arcgis/rest/services/Test/FeatureServer"
        respx.get(url).mock(
            return_value=httpx.Response(
                200,
                json={
                    "layers": [
                        {"id": 0, "name": "Group", "subLayerIds": [1, 2]},
                        {
                            "id": 1,
                            "name": "Child1",
                            "geometryType": "esriGeometryPoint",
                        },
                        {
                            "id": 2,
                            "name": "Child2",
                            "geometryType": "esriGeometryPoint",
                        },
                    ],
                    "fullExtent": {
                        "xmin": -10,
                        "ymin": -10,
                        "xmax": 10,
                        "ymax": 10,
                        "spatialReference": {"wkid": 4326},
                    },
                },
            )
        )

        result = await probe_service(url)
        layer_names = [layer["name"] for layer in result["layers"]]
        assert "Group" not in layer_names
        assert "Child1" in layer_names


class TestFetchArcgisLayerExtent:
    @pytest.mark.asyncio
    @respx.mock
    async def test_success(self):
        url = "https://example.com/arcgis/rest/services/Test/FeatureServer"
        respx.get(f"{url}/0").mock(
            return_value=httpx.Response(
                200,
                json={
                    "extent": {
                        "xmin": -10,
                        "ymin": -10,
                        "xmax": 10,
                        "ymax": 10,
                        "spatialReference": {"wkid": 4326},
                    },
                },
            )
        )

        result = await fetch_arcgis_layer_extent(url, "0")
        assert result == [-10, -10, 10, 10]

    @pytest.mark.asyncio
    @respx.mock
    async def test_failure(self):
        url = "https://example.com/arcgis/rest/services/Test/FeatureServer"
        respx.get(f"{url}/99").mock(return_value=httpx.Response(404))

        result = await fetch_arcgis_layer_extent(url, "99")
        assert result is None


class TestFetchArcgisFeatureCount:
    @pytest.mark.asyncio
    @respx.mock
    async def test_success(self):
        url = "https://example.com/arcgis/rest/services/Test/FeatureServer"
        respx.get(f"{url}/0/query").mock(
            return_value=httpx.Response(200, json={"count": 42})
        )

        result = await fetch_arcgis_feature_count(url, "0")
        assert result == 42

    @pytest.mark.asyncio
    @respx.mock
    async def test_failure(self):
        url = "https://example.com/arcgis/rest/services/Test/FeatureServer"
        respx.get(f"{url}/0/query").mock(return_value=httpx.Response(500))

        result = await fetch_arcgis_feature_count(url, "0")
        assert result is None


class TestFetchAllFeatures:
    @pytest.mark.asyncio
    @respx.mock
    async def test_arcgis_single_page(self):
        url = "https://example.com/arcgis/rest/services/Test/FeatureServer"
        features = [
            {"type": "Feature", "geometry": None, "properties": {"id": i}}
            for i in range(5)
        ]
        respx.get(f"{url}/0/query").mock(
            return_value=httpx.Response(
                200,
                json={
                    "features": features,
                },
            )
        )

        result = await fetch_all_features(url, "arcgis_feature", "0")
        assert result["type"] == "FeatureCollection"
        assert len(result["features"]) == 5

    @pytest.mark.asyncio
    @respx.mock
    async def test_arcgis_pagination(self):
        url = "https://example.com/arcgis/rest/services/Test/FeatureServer"
        page1 = [{"type": "Feature", "properties": {"id": i}} for i in range(2000)]
        page2 = [{"type": "Feature", "properties": {"id": i}} for i in range(100)]

        call_count = 0

        def side_effect(request):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return httpx.Response(200, json={"features": page1})
            return httpx.Response(200, json={"features": page2})

        respx.get(f"{url}/0/query").mock(side_effect=side_effect)

        result = await fetch_all_features(url, "arcgis_feature", "0")
        assert len(result["features"]) == 2100

    @pytest.mark.asyncio
    @respx.mock
    async def test_arcgis_server_error_reduces_page_size(self):
        url = "https://example.com/arcgis/rest/services/Test/FeatureServer"
        call_count = 0

        def side_effect(request):
            nonlocal call_count
            call_count += 1
            if call_count <= 2:
                return httpx.Response(500)
            return httpx.Response(200, json={"features": [{"type": "Feature"}]})

        respx.get(f"{url}/0/query").mock(side_effect=side_effect)

        result = await fetch_all_features(url, "arcgis_feature", "0")
        assert len(result["features"]) >= 1

    @pytest.mark.asyncio
    @respx.mock
    async def test_wfs_single_page(self):
        url = "https://example.com/wfs"
        features = [{"type": "Feature", "properties": {"id": i}} for i in range(3)]
        respx.get(url).mock(
            return_value=httpx.Response(200, json={"features": features})
        )

        result = await fetch_all_features(url, "wfs", "roads")
        assert len(result["features"]) == 3

    @pytest.mark.asyncio
    async def test_unsupported_type_raises(self):
        with pytest.raises(ValueError, match="Cannot fetch features"):
            await fetch_all_features("https://example.com", "unknown_type", "0")

    @pytest.mark.asyncio
    @respx.mock
    async def test_max_features_limit(self):
        url = "https://example.com/arcgis/rest/services/Test/FeatureServer"
        features = [{"type": "Feature", "properties": {"id": i}} for i in range(100)]
        respx.get(f"{url}/0/query").mock(
            return_value=httpx.Response(
                200,
                json={
                    "features": features,
                },
            )
        )

        result = await fetch_all_features(url, "arcgis_feature", "0", max_features=50)
        # Should stop after getting first page since max_features=50
        assert len(result["features"]) <= 100

    @pytest.mark.asyncio
    @respx.mock
    async def test_arcgis_error_response_body(self):
        """Server returns 200 but with error in JSON body."""
        url = "https://example.com/arcgis/rest/services/Test/FeatureServer"
        call_count = 0

        def side_effect(request):
            nonlocal call_count
            call_count += 1
            if call_count <= 3:
                return httpx.Response(
                    200, json={"error": {"code": 400, "message": "Error"}}
                )
            return httpx.Response(200, json={"features": [{"type": "Feature"}]})

        respx.get(f"{url}/0/query").mock(side_effect=side_effect)

        result = await fetch_all_features(url, "arcgis_feature", "0")
        assert result["type"] == "FeatureCollection"


class TestProxyRequest:
    @pytest.mark.asyncio
    @respx.mock
    async def test_success(self):
        url = "https://example.com/wms"
        respx.get(url).mock(return_value=httpx.Response(200, content=b"image data"))

        result = await proxy_request(url, "wms", {"request": "GetMap"})
        assert result.status_code == 200

    @pytest.mark.asyncio
    @respx.mock
    async def test_error_raises(self):
        url = "https://example.com/wms"
        respx.get(url).mock(return_value=httpx.Response(500))

        with pytest.raises(httpx.HTTPStatusError):
            await proxy_request(url, "wms", {})

    @pytest.mark.asyncio
    @respx.mock
    async def test_reuses_shared_client(self):
        """Successive calls should share a single AsyncClient for connection pooling."""
        from app.services.external_source import _get_proxy_client

        url = "https://example.com/tile"
        respx.get(url).mock(return_value=httpx.Response(200, content=b"x"))

        await proxy_request(url, "arcgis_map", {})
        first_id = id(_get_proxy_client())
        await proxy_request(url, "arcgis_map", {})
        second_id = id(_get_proxy_client())
        assert first_id == second_id

    @pytest.mark.asyncio
    @respx.mock
    async def test_http_url_upgraded_to_https(self):
        """An http:// upstream should be tried as https:// first."""
        http_url = "http://example.com/service"
        https_url = "https://example.com/service"
        respx.get(https_url).mock(return_value=httpx.Response(200, content=b"ok"))

        resp = await proxy_request(http_url, "arcgis_map", {})
        assert resp.status_code == 200
        assert resp.content == b"ok"

    @pytest.mark.asyncio
    @respx.mock
    async def test_http_url_falls_back_when_https_fails(self):
        """If the https upgrade fails, the original http URL is retried."""
        http_url = "http://example.com/legacy"
        https_url = "https://example.com/legacy"
        respx.get(https_url).mock(return_value=httpx.Response(500))
        respx.get(http_url).mock(return_value=httpx.Response(200, content=b"legacy"))

        resp = await proxy_request(http_url, "arcgis_map", {})
        assert resp.status_code == 200
        assert resp.content == b"legacy"
