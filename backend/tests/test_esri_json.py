"""Tests for ESRI JSON conversion utilities."""

import pytest

from app.services.arcgis.esri_json import (
    geojson_geometry_to_esri,
    geojson_to_esri_geometry_type,
    python_type_to_esri_field_type,
    build_field_definition,
    build_spatial_reference,
    build_extent,
    geojson_feature_to_esri,
    build_query_response,
    build_count_response,
    build_ids_response,
)


# ── Geometry Conversion ──────────────────────────────────────────────


class TestGeojsonGeometryToEsri:
    def test_point(self):
        geom = {"type": "Point", "coordinates": [-122.4, 37.8]}
        result = geojson_geometry_to_esri(geom)
        assert result == {"x": -122.4, "y": 37.8}

    def test_multipoint(self):
        geom = {"type": "MultiPoint", "coordinates": [[0, 0], [1, 1]]}
        result = geojson_geometry_to_esri(geom)
        assert result == {"points": [[0, 0], [1, 1]]}

    def test_linestring(self):
        geom = {"type": "LineString", "coordinates": [[0, 0], [1, 1], [2, 2]]}
        result = geojson_geometry_to_esri(geom)
        assert result == {"paths": [[[0, 0], [1, 1], [2, 2]]]}

    def test_multilinestring(self):
        geom = {"type": "MultiLineString", "coordinates": [[[0, 0], [1, 1]], [[2, 2], [3, 3]]]}
        result = geojson_geometry_to_esri(geom)
        assert result == {"paths": [[[0, 0], [1, 1]], [[2, 2], [3, 3]]]}

    def test_polygon(self):
        ring = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]
        geom = {"type": "Polygon", "coordinates": [ring]}
        result = geojson_geometry_to_esri(geom)
        assert result == {"rings": [ring]}

    def test_polygon_with_holes(self):
        outer = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]
        hole = [[2, 2], [8, 2], [8, 8], [2, 8], [2, 2]]
        geom = {"type": "Polygon", "coordinates": [outer, hole]}
        result = geojson_geometry_to_esri(geom)
        assert result == {"rings": [outer, hole]}

    def test_multipolygon(self):
        ring1 = [[0, 0], [1, 0], [1, 1], [0, 0]]
        ring2 = [[5, 5], [6, 5], [6, 6], [5, 5]]
        geom = {"type": "MultiPolygon", "coordinates": [[ring1], [ring2]]}
        result = geojson_geometry_to_esri(geom)
        assert result == {"rings": [ring1, ring2]}

    def test_none_geometry(self):
        assert geojson_geometry_to_esri(None) is None

    def test_missing_type(self):
        assert geojson_geometry_to_esri({"coordinates": [0, 0]}) is None

    def test_missing_coordinates(self):
        assert geojson_geometry_to_esri({"type": "Point"}) is None

    def test_unknown_type(self):
        geom = {"type": "GeometryCollection", "coordinates": []}
        assert geojson_geometry_to_esri(geom) is None


# ── Geometry Type Mapping ─────────────────────────────────────────────


class TestGeojsonToEsriGeometryType:
    @pytest.mark.parametrize(
        "geojson_type,esri_type",
        [
            ("Point", "esriGeometryPoint"),
            ("MultiPoint", "esriGeometryMultipoint"),
            ("LineString", "esriGeometryPolyline"),
            ("MultiLineString", "esriGeometryPolyline"),
            ("Polygon", "esriGeometryPolygon"),
            ("MultiPolygon", "esriGeometryPolygon"),
        ],
    )
    def test_known_types(self, geojson_type, esri_type):
        assert geojson_to_esri_geometry_type(geojson_type) == esri_type

    def test_unknown_type_defaults_to_polygon(self):
        assert geojson_to_esri_geometry_type("Unknown") == "esriGeometryPolygon"

    def test_none_defaults_to_polygon(self):
        assert geojson_to_esri_geometry_type(None) == "esriGeometryPolygon"

    def test_empty_string_defaults_to_polygon(self):
        assert geojson_to_esri_geometry_type("") == "esriGeometryPolygon"


# ── Field Type Inference ──────────────────────────────────────────────


class TestPythonTypeToEsriFieldType:
    @pytest.mark.parametrize(
        "value,expected",
        [
            (None, "esriFieldTypeString"),
            (True, "esriFieldTypeSmallInteger"),
            (False, "esriFieldTypeSmallInteger"),
            (42, "esriFieldTypeInteger"),
            (3.14, "esriFieldTypeDouble"),
            ("hello", "esriFieldTypeString"),
            ([1, 2], "esriFieldTypeString"),
            ({"a": 1}, "esriFieldTypeString"),
        ],
    )
    def test_type_inference(self, value, expected):
        assert python_type_to_esri_field_type(value) == expected

    def test_bool_before_int(self):
        """Bool is a subclass of int, so it must be checked first."""
        assert python_type_to_esri_field_type(True) == "esriFieldTypeSmallInteger"
        assert python_type_to_esri_field_type(1) == "esriFieldTypeInteger"


# ── Field Definition ──────────────────────────────────────────────────


class TestBuildFieldDefinition:
    def test_string_field(self):
        field = build_field_definition("name", "esriFieldTypeString")
        assert field["name"] == "name"
        assert field["type"] == "esriFieldTypeString"
        assert field["alias"] == "name"
        assert field["length"] == 4000

    def test_integer_field_no_length(self):
        field = build_field_definition("count", "esriFieldTypeInteger")
        assert "length" not in field

    def test_custom_alias(self):
        field = build_field_definition("pop", "esriFieldTypeInteger", alias="Population")
        assert field["alias"] == "Population"


# ── Spatial Reference & Extent ────────────────────────────────────────


class TestBuildSpatialReference:
    def test_default(self):
        sr = build_spatial_reference()
        assert sr == {"wkid": 4326, "latestWkid": 4326}

    def test_custom_wkid(self):
        sr = build_spatial_reference(3857)
        assert sr["wkid"] == 3857


class TestBuildExtent:
    def test_default(self):
        ext = build_extent()
        assert ext["xmin"] == -180
        assert ext["ymax"] == 90
        assert ext["spatialReference"]["wkid"] == 4326

    def test_custom(self):
        ext = build_extent(0, 0, 100, 100, 3857)
        assert ext["xmin"] == 0
        assert ext["ymax"] == 100
        assert ext["spatialReference"]["wkid"] == 3857


# ── Feature Conversion ───────────────────────────────────────────────


class TestGeojsonFeatureToEsri:
    def test_basic(self):
        feature = {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [0, 0]},
            "properties": {"name": "Test", "value": 42},
        }
        result = geojson_feature_to_esri(feature, object_id=1)
        assert result["attributes"]["OBJECTID"] == 1
        assert result["attributes"]["name"] == "Test"
        assert result["attributes"]["value"] == 42
        assert result["geometry"] == {"x": 0, "y": 0}

    def test_without_geometry(self):
        feature = {
            "properties": {"name": "Test"},
            "geometry": {"type": "Point", "coordinates": [0, 0]},
        }
        result = geojson_feature_to_esri(feature, object_id=1, include_geometry=False)
        assert "geometry" not in result
        assert result["attributes"]["name"] == "Test"

    def test_reserved_fields_skipped(self):
        feature = {
            "properties": {"OBJECTID": 999, "FID": 888, "name": "keep"},
            "geometry": None,
        }
        result = geojson_feature_to_esri(feature, object_id=1)
        assert result["attributes"]["OBJECTID"] == 1  # Not overwritten
        assert "FID" not in result["attributes"]
        assert result["attributes"]["name"] == "keep"

    def test_list_dict_values_stringified(self):
        feature = {
            "properties": {"tags": ["a", "b"], "meta": {"key": "val"}},
            "geometry": None,
        }
        result = geojson_feature_to_esri(feature, object_id=1)
        assert result["attributes"]["tags"] == "['a', 'b']"
        assert result["attributes"]["meta"] == "{'key': 'val'}"

    def test_empty_list_becomes_none(self):
        feature = {"properties": {"tags": []}, "geometry": None}
        result = geojson_feature_to_esri(feature, object_id=1)
        assert result["attributes"]["tags"] is None

    def test_no_properties(self):
        feature = {"geometry": {"type": "Point", "coordinates": [0, 0]}}
        result = geojson_feature_to_esri(feature, object_id=5)
        assert result["attributes"] == {"OBJECTID": 5}


# ── Response Builders ─────────────────────────────────────────────────


class TestBuildQueryResponse:
    def test_basic(self):
        features = [{"attributes": {"OBJECTID": 1}}]
        fields = [{"name": "OBJECTID", "type": "esriFieldTypeOID"}]
        result = build_query_response(
            features=features,
            fields=fields,
            geometry_type="esriGeometryPoint",
        )
        assert result["objectIdFieldName"] == "OBJECTID"
        assert result["geometryType"] == "esriGeometryPoint"
        assert result["features"] == features
        assert result["fields"] == fields
        assert result["exceededTransferLimit"] is False
        assert result["spatialReference"]["wkid"] == 4326

    def test_exceeded_limit(self):
        result = build_query_response(
            features=[],
            fields=[],
            geometry_type="esriGeometryPoint",
            exceeded_transfer_limit=True,
        )
        assert result["exceededTransferLimit"] is True


class TestBuildCountResponse:
    def test_basic(self):
        assert build_count_response(42) == {"count": 42}

    def test_zero(self):
        assert build_count_response(0) == {"count": 0}


class TestBuildIdsResponse:
    def test_basic(self):
        result = build_ids_response([1, 2, 3])
        assert result["objectIdFieldName"] == "OBJECTID"
        assert result["objectIds"] == [1, 2, 3]

    def test_empty(self):
        result = build_ids_response([])
        assert result["objectIds"] == []

    def test_custom_field(self):
        result = build_ids_response([1], object_id_field="FID")
        assert result["objectIdFieldName"] == "FID"
