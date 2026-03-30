"""Tests for OGC Filter Encoding parser."""

import pytest

from app.services.wfs.filter_parser import parse_ogc_filter


# Helper to wrap filter content in OGC Filter XML
def ogc(inner: str) -> str:
    return f'<Filter xmlns="http://www.opengis.net/ogc" xmlns:gml="http://www.opengis.net/gml">{inner}</Filter>'


def plain(inner: str) -> str:
    """Non-namespaced filter XML."""
    return f"<Filter>{inner}</Filter>"


# ── Comparison Operators ──────────────────────────────────────────────


class TestPropertyIsEqualTo:
    def test_basic(self):
        xml = ogc(
            "<PropertyIsEqualTo>"
            "<PropertyName>name</PropertyName>"
            "<Literal>San Francisco</Literal>"
            "</PropertyIsEqualTo>"
        )
        clause, params = parse_ogc_filter(xml)
        assert clause == "(properties->>'name') = :p_0"
        assert params == {"p_0": "San Francisco"}

    def test_without_namespace(self):
        xml = plain(
            "<PropertyIsEqualTo>"
            "<PropertyName>status</PropertyName>"
            "<Literal>active</Literal>"
            "</PropertyIsEqualTo>"
        )
        clause, params = parse_ogc_filter(xml)
        assert clause == "(properties->>'status') = :p_0"
        assert params == {"p_0": "active"}

    def test_missing_literal(self):
        xml = ogc(
            "<PropertyIsEqualTo>"
            "<PropertyName>name</PropertyName>"
            "</PropertyIsEqualTo>"
        )
        clause, params = parse_ogc_filter(xml)
        assert clause is None

    def test_missing_property(self):
        xml = ogc(
            "<PropertyIsEqualTo>" "<Literal>test</Literal>" "</PropertyIsEqualTo>"
        )
        clause, params = parse_ogc_filter(xml)
        assert clause is None


class TestPropertyIsNotEqualTo:
    def test_basic(self):
        xml = ogc(
            "<PropertyIsNotEqualTo>"
            "<PropertyName>type</PropertyName>"
            "<Literal>deleted</Literal>"
            "</PropertyIsNotEqualTo>"
        )
        clause, params = parse_ogc_filter(xml)
        assert clause == "(properties->>'type') != :p_0"
        assert params == {"p_0": "deleted"}


class TestComparisonOperators:
    @pytest.mark.parametrize(
        "tag,operator",
        [
            ("PropertyIsLessThan", "<"),
            ("PropertyIsGreaterThan", ">"),
            ("PropertyIsLessThanOrEqualTo", "<="),
            ("PropertyIsGreaterThanOrEqualTo", ">="),
        ],
    )
    def test_operator(self, tag, operator):
        xml = ogc(
            f"<{tag}>"
            "<PropertyName>population</PropertyName>"
            "<Literal>1000</Literal>"
            f"</{tag}>"
        )
        clause, params = parse_ogc_filter(xml)
        assert clause == f"(properties->>'population') {operator} :p_0"
        assert params == {"p_0": "1000"}


# ── PropertyIsLike ────────────────────────────────────────────────────


class TestPropertyIsLike:
    def test_wildcard(self):
        xml = ogc(
            '<PropertyIsLike wildCard="*" singleChar="?" escapeChar="\\">'
            "<PropertyName>name</PropertyName>"
            "<Literal>San*</Literal>"
            "</PropertyIsLike>"
        )
        clause, params = parse_ogc_filter(xml)
        assert clause == "(properties->>'name') LIKE :p_0"
        assert params == {"p_0": "San%"}

    def test_single_char(self):
        xml = ogc(
            '<PropertyIsLike wildCard="*" singleChar="?" escapeChar="\\">'
            "<PropertyName>code</PropertyName>"
            "<Literal>A?B</Literal>"
            "</PropertyIsLike>"
        )
        clause, params = parse_ogc_filter(xml)
        assert params == {"p_0": "A_B"}

    def test_case_insensitive(self):
        xml = ogc(
            '<PropertyIsLike wildCard="*" singleChar="?" escapeChar="\\" matchCase="false">'
            "<PropertyName>name</PropertyName>"
            "<Literal>*test*</Literal>"
            "</PropertyIsLike>"
        )
        clause, params = parse_ogc_filter(xml)
        assert clause == "(properties->>'name') ILIKE :p_0"
        assert params == {"p_0": "%test%"}

    def test_escaped_wildcard(self):
        xml = ogc(
            '<PropertyIsLike wildCard="*" singleChar="?" escapeChar="\\">'
            "<PropertyName>name</PropertyName>"
            "<Literal>100\\*</Literal>"
            "</PropertyIsLike>"
        )
        clause, params = parse_ogc_filter(xml)
        # Escaped wildcard should remain as literal *
        assert params == {"p_0": "100*"}

    def test_default_wildcards(self):
        xml = ogc(
            "<PropertyIsLike>"
            "<PropertyName>name</PropertyName>"
            "<Literal>*test*</Literal>"
            "</PropertyIsLike>"
        )
        clause, params = parse_ogc_filter(xml)
        assert params == {"p_0": "%test%"}


# ── PropertyIsNull ────────────────────────────────────────────────────


class TestPropertyIsNull:
    def test_basic(self):
        xml = ogc(
            "<PropertyIsNull>"
            "<PropertyName>description</PropertyName>"
            "</PropertyIsNull>"
        )
        clause, params = parse_ogc_filter(xml)
        assert clause == "(properties->>'description') IS NULL"
        assert params == {}

    def test_missing_property(self):
        xml = ogc("<PropertyIsNull></PropertyIsNull>")
        clause, params = parse_ogc_filter(xml)
        assert clause is None


# ── PropertyIsBetween ─────────────────────────────────────────────────


class TestPropertyIsBetween:
    def test_basic(self):
        xml = ogc(
            "<PropertyIsBetween>"
            "<PropertyName>population</PropertyName>"
            "<LowerBoundary><Literal>100</Literal></LowerBoundary>"
            "<UpperBoundary><Literal>1000</Literal></UpperBoundary>"
            "</PropertyIsBetween>"
        )
        clause, params = parse_ogc_filter(xml)
        assert "BETWEEN" in clause
        assert params["lower_0"] == "100"
        assert params["upper_0"] == "1000"

    def test_missing_bounds(self):
        xml = ogc(
            "<PropertyIsBetween>"
            "<PropertyName>population</PropertyName>"
            "</PropertyIsBetween>"
        )
        clause, params = parse_ogc_filter(xml)
        assert clause is None

    def test_with_namespaces(self):
        xml = ogc(
            "<PropertyIsBetween>"
            "<PropertyName>value</PropertyName>"
            "<LowerBoundary><Literal>0</Literal></LowerBoundary>"
            "<UpperBoundary><Literal>100</Literal></UpperBoundary>"
            "</PropertyIsBetween>"
        )
        clause, params = parse_ogc_filter(xml)
        assert "(properties->>'value')::numeric BETWEEN" in clause


# ── Logical Operators ─────────────────────────────────────────────────


class TestLogicalOperators:
    def test_and(self):
        xml = ogc(
            "<And>"
            "<PropertyIsEqualTo><PropertyName>status</PropertyName><Literal>active</Literal></PropertyIsEqualTo>"
            "<PropertyIsGreaterThan><PropertyName>count</PropertyName><Literal>10</Literal></PropertyIsGreaterThan>"
            "</And>"
        )
        clause, params = parse_ogc_filter(xml)
        assert "AND" in clause
        assert len(params) == 2

    def test_or(self):
        xml = ogc(
            "<Or>"
            "<PropertyIsEqualTo><PropertyName>type</PropertyName><Literal>a</Literal></PropertyIsEqualTo>"
            "<PropertyIsEqualTo><PropertyName>type</PropertyName><Literal>b</Literal></PropertyIsEqualTo>"
            "</Or>"
        )
        clause, params = parse_ogc_filter(xml)
        assert "OR" in clause
        assert len(params) == 2

    def test_not(self):
        xml = ogc(
            "<Not>"
            "<PropertyIsEqualTo><PropertyName>deleted</PropertyName><Literal>true</Literal></PropertyIsEqualTo>"
            "</Not>"
        )
        clause, params = parse_ogc_filter(xml)
        assert clause.startswith("NOT (")
        assert params == {"p_0": "true"}

    def test_nested_and_or(self):
        xml = ogc(
            "<And>"
            "<Or>"
            "<PropertyIsEqualTo><PropertyName>a</PropertyName><Literal>1</Literal></PropertyIsEqualTo>"
            "<PropertyIsEqualTo><PropertyName>b</PropertyName><Literal>2</Literal></PropertyIsEqualTo>"
            "</Or>"
            "<PropertyIsGreaterThan><PropertyName>c</PropertyName><Literal>0</Literal></PropertyIsGreaterThan>"
            "</And>"
        )
        clause, params = parse_ogc_filter(xml)
        assert "AND" in clause
        assert "OR" in clause
        assert len(params) == 3

    def test_empty_and(self):
        xml = ogc("<And></And>")
        clause, params = parse_ogc_filter(xml)
        assert clause is None

    def test_empty_not(self):
        xml = ogc("<Not></Not>")
        clause, params = parse_ogc_filter(xml)
        assert clause is None

    def test_empty_or(self):
        xml = ogc("<Or></Or>")
        clause, params = parse_ogc_filter(xml)
        assert clause is None


# ── Spatial Operators ─────────────────────────────────────────────────


class TestBBOX:
    def test_basic(self):
        xml = ogc(
            "<BBOX>"
            "<PropertyName>geom</PropertyName>"
            '<gml:Envelope srsName="EPSG:4326">'
            "<gml:lowerCorner>-122.5 37.5</gml:lowerCorner>"
            "<gml:upperCorner>-122.0 38.0</gml:upperCorner>"
            "</gml:Envelope>"
            "</BBOX>"
        )
        clause, params = parse_ogc_filter(xml)
        assert "ST_Intersects" in clause
        assert "ST_MakeEnvelope" in clause
        assert params["bbox_minx_0"] == -122.5
        assert params["bbox_miny_0"] == 37.5
        assert params["bbox_maxx_0"] == -122.0
        assert params["bbox_maxy_0"] == 38.0

    def test_without_namespace(self):
        xml = plain(
            "<BBOX>"
            "<PropertyName>geom</PropertyName>"
            "<Envelope>"
            "<lowerCorner>0 0</lowerCorner>"
            "<upperCorner>10 10</upperCorner>"
            "</Envelope>"
            "</BBOX>"
        )
        clause, params = parse_ogc_filter(xml)
        assert "ST_Intersects" in clause
        assert params["bbox_minx_0"] == 0.0
        assert params["bbox_maxy_0"] == 10.0

    def test_missing_envelope(self):
        xml = ogc("<BBOX><PropertyName>geom</PropertyName></BBOX>")
        clause, params = parse_ogc_filter(xml)
        assert clause is None

    def test_invalid_coordinates(self):
        xml = ogc(
            "<BBOX>"
            '<gml:Envelope srsName="EPSG:4326">'
            "<gml:lowerCorner>not a number</gml:lowerCorner>"
            "<gml:upperCorner>-122.0 38.0</gml:upperCorner>"
            "</gml:Envelope>"
            "</BBOX>"
        )
        clause, params = parse_ogc_filter(xml)
        assert clause is None


class TestSpatialOperators:
    @pytest.mark.parametrize(
        "tag,func",
        [
            ("Intersects", "ST_Intersects"),
            ("Within", "ST_Within"),
            ("Contains", "ST_Contains"),
        ],
    )
    def test_with_envelope(self, tag, func):
        xml = ogc(
            f"<{tag}>"
            "<PropertyName>geom</PropertyName>"
            '<gml:Envelope srsName="EPSG:4326">'
            "<gml:lowerCorner>-180 -90</gml:lowerCorner>"
            "<gml:upperCorner>180 90</gml:upperCorner>"
            "</gml:Envelope>"
            f"</{tag}>"
        )
        clause, params = parse_ogc_filter(xml)
        assert func in clause
        assert "ST_MakeEnvelope" in clause
        assert len(params) == 4

    def test_missing_envelope(self):
        xml = ogc("<Intersects><PropertyName>geom</PropertyName></Intersects>")
        clause, params = parse_ogc_filter(xml)
        assert clause is None


# ── Feature ID ────────────────────────────────────────────────────────


class TestFeatureId:
    def test_basic(self):
        xml = ogc('<FeatureId fid="gis:dataset.123"/>')
        clause, params = parse_ogc_filter(xml)
        assert clause == "id = :fid_0"
        assert params == {"fid_0": 123}

    def test_gml_object_id(self):
        xml = ogc('<GmlObjectId gml:id="gis:dataset.456"/>')
        clause, params = parse_ogc_filter(xml)
        assert clause == "id = :fid_0"
        assert params == {"fid_0": 456}

    def test_invalid_fid_format(self):
        xml = ogc('<FeatureId fid="not-a-number"/>')
        clause, params = parse_ogc_filter(xml)
        assert clause is None

    def test_missing_fid(self):
        xml = ogc("<FeatureId/>")
        clause, params = parse_ogc_filter(xml)
        assert clause is None


# ── Edge Cases ────────────────────────────────────────────────────────


class TestEdgeCases:
    def test_empty_filter(self):
        xml = ogc("")
        clause, params = parse_ogc_filter(xml)
        assert clause is None

    def test_malformed_xml(self):
        clause, params = parse_ogc_filter("<not valid xml><<<")
        assert clause is None
        assert params == {}

    def test_unknown_element(self):
        xml = ogc("<UnknownOperator><PropertyName>x</PropertyName></UnknownOperator>")
        clause, params = parse_ogc_filter(xml)
        assert clause is None

    def test_whitespace_in_property_name(self):
        xml = ogc(
            "<PropertyIsEqualTo>"
            "<PropertyName> name </PropertyName>"
            "<Literal>test</Literal>"
            "</PropertyIsEqualTo>"
        )
        clause, params = parse_ogc_filter(xml)
        assert clause == "(properties->>'name') = :p_0"

    def test_empty_literal(self):
        """Literal with empty text should still work."""
        xml = ogc(
            "<PropertyIsEqualTo>"
            "<PropertyName>name</PropertyName>"
            "<Literal></Literal>"
            "</PropertyIsEqualTo>"
        )
        clause, params = parse_ogc_filter(xml)
        # Empty text means lit_elem.text is None, so it returns None
        assert clause is None
