"""Tests for style exporter service."""

import json
import pytest
from xml.etree.ElementTree import fromstring

from app.services.style_exporter import (
    generate_sld,
    generate_lyrx,
    generate_qml,
)


UNIFORM_STYLE = {
    "mode": "uniform",
    "fillColor": [255, 0, 0, 200],
    "lineColor": [0, 0, 0, 255],
    "lineWidth": 2,
}

CATEGORICAL_STYLE = {
    "mode": "categorical",
    "fillColor": [128, 128, 128, 255],
    "lineColor": [0, 0, 0, 255],
    "lineWidth": 1,
    "attributeField": "landuse",
    "categoryColors": {
        "residential": [255, 0, 0, 200],
        "commercial": [0, 0, 255, 200],
        "park": [0, 255, 0, 200],
    },
}

GRADUATED_STYLE = {
    "mode": "graduated",
    "fillColor": [128, 128, 128, 255],
    "lineColor": [0, 0, 0, 255],
    "lineWidth": 1,
    "attributeField": "population",
    "colorRamp": {
        "name": "viridis",
        "minValue": 0,
        "maxValue": 100000,
        "numClasses": 5,
    },
}


class TestGenerateSld:
    def test_uniform_produces_valid_xml(self):
        result = generate_sld(UNIFORM_STYLE, "test_layer", "Polygon")
        root = fromstring(result)
        assert root.tag.endswith("StyledLayerDescriptor")

    def test_uniform_contains_fill_color(self):
        result = generate_sld(UNIFORM_STYLE, "test_layer", "Polygon")
        assert "#ff0000" in result.lower() or "ff0000" in result.lower()

    def test_categorical_produces_valid_xml(self):
        result = generate_sld(CATEGORICAL_STYLE, "test_layer", "Polygon")
        root = fromstring(result)
        assert root.tag.endswith("StyledLayerDescriptor")

    def test_categorical_contains_rules(self):
        result = generate_sld(CATEGORICAL_STYLE, "test_layer", "Polygon")
        assert "residential" in result
        assert "commercial" in result
        assert "park" in result

    def test_graduated_produces_valid_xml(self):
        result = generate_sld(GRADUATED_STYLE, "test_layer", "Polygon")
        root = fromstring(result)
        assert root.tag.endswith("StyledLayerDescriptor")

    def test_point_geometry_type(self):
        result = generate_sld(UNIFORM_STYLE, "test_layer", "Point")
        root = fromstring(result)
        assert root.tag.endswith("StyledLayerDescriptor")

    def test_line_geometry_type(self):
        result = generate_sld(UNIFORM_STYLE, "test_layer", "LineString")
        root = fromstring(result)
        assert root.tag.endswith("StyledLayerDescriptor")


class TestGenerateLyrx:
    def test_uniform_produces_valid_json(self):
        result = generate_lyrx(UNIFORM_STYLE, "test_layer", "Polygon")
        data = json.loads(result)
        assert "type" in data

    def test_categorical_produces_valid_json(self):
        result = generate_lyrx(CATEGORICAL_STYLE, "test_layer", "Polygon")
        data = json.loads(result)
        assert "type" in data

    def test_graduated_produces_valid_json(self):
        result = generate_lyrx(GRADUATED_STYLE, "test_layer", "Polygon")
        data = json.loads(result)
        assert "type" in data

    def test_layer_name_in_output(self):
        result = generate_lyrx(UNIFORM_STYLE, "my_layer", "Polygon")
        assert "my_layer" in result


class TestGenerateQml:
    def test_uniform_produces_valid_xml(self):
        result = generate_qml(UNIFORM_STYLE, "test_layer", "Polygon")
        root = fromstring(result)
        assert root.tag == "qgis"

    def test_categorical_produces_valid_xml(self):
        result = generate_qml(CATEGORICAL_STYLE, "test_layer", "Polygon")
        root = fromstring(result)
        assert root.tag == "qgis"

    def test_graduated_produces_valid_xml(self):
        result = generate_qml(GRADUATED_STYLE, "test_layer", "Polygon")
        root = fromstring(result)
        assert root.tag == "qgis"

    def test_contains_renderer(self):
        result = generate_qml(UNIFORM_STYLE, "test_layer", "Polygon")
        assert "renderer" in result.lower()
