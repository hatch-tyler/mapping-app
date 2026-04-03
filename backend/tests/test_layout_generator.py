"""Tests for layout_generator.py."""

import json
from xml.etree.ElementTree import fromstring

from app.services.layout_generator import (
    _hex_to_rgba,
    _hex_to_rgb_list,
    generate_qpt,
    generate_pagx,
)


class TestHelpers:
    def test_hex_to_rgba_valid(self):
        assert _hex_to_rgba("#ff0000") == "255,0,0,255"
        assert _hex_to_rgba("#1e40af") == "30,64,175,255"

    def test_hex_to_rgba_invalid(self):
        assert _hex_to_rgba("invalid") == "0,0,0,255"

    def test_hex_to_rgb_list_valid(self):
        assert _hex_to_rgb_list("#ff0000") == [255, 0, 0]
        assert _hex_to_rgb_list("#1e40af") == [30, 64, 175]

    def test_hex_to_rgb_list_invalid(self):
        assert _hex_to_rgb_list("bad") == [0, 0, 0]


class TestGenerateQpt:
    def setup_method(self):
        self.page = {"width": 279.4, "height": 215.9, "orientation": "landscape"}

    def test_produces_valid_xml(self):
        result = generate_qpt(self.page, [], "Test")
        root = fromstring(result)
        assert root.tag == "Layout"
        assert root.get("name") == "Test"

    def test_page_collection_present(self):
        result = generate_qpt(self.page, [])
        root = fromstring(result)
        page_collection = root.find("PageCollection")
        assert page_collection is not None

    def test_map_frame_element(self):
        elems = [{"type": "map_frame", "x": 10, "y": 20, "w": 180, "h": 150}]
        result = generate_qpt(self.page, elems)
        assert 'type="65639"' in result

    def test_title_element(self):
        elems = [
            {"type": "title", "x": 10, "y": 5, "w": 100, "h": 15, "text": "My Map"}
        ]
        result = generate_qpt(self.page, elems)
        assert "My Map" in result
        assert 'halign="4"' in result  # center

    def test_legend_element(self):
        elems = [{"type": "legend", "x": 200, "y": 50, "w": 60, "h": 80}]
        result = generate_qpt(self.page, elems)
        assert 'type="65642"' in result

    def test_scale_bar_element(self):
        elems = [{"type": "scale_bar", "x": 10, "y": 190, "w": 100, "h": 15}]
        result = generate_qpt(self.page, elems)
        assert 'type="65646"' in result

    def test_north_arrow_element(self):
        elems = [{"type": "north_arrow", "x": 260, "y": 180, "w": 15, "h": 20}]
        result = generate_qpt(self.page, elems)
        assert 'type="65640"' in result

    def test_horizontal_rule_element(self):
        elems = [
            {
                "type": "horizontal_rule",
                "x": 10,
                "y": 100,
                "w": 260,
                "h": 1,
                "color": "#1e40af",
            }
        ]
        result = generate_qpt(self.page, elems)
        assert "30,64,175,255" in result

    def test_portrait_orientation_swaps_dimensions(self):
        page = {"width": 215.9, "height": 279.4, "orientation": "portrait"}
        result = generate_qpt(page, [])
        root = fromstring(result)
        page_item = root.find(".//PageCollection/LayoutItem")
        size = page_item.get("size")
        w, h = size.replace(",mm", "").split(",")[:2]
        assert float(w) < float(h)


class TestGeneratePagx:
    def setup_method(self):
        self.page = {"width": 279.4, "height": 215.9, "orientation": "landscape"}

    def test_produces_valid_json(self):
        result = generate_pagx(self.page, [], "Test")
        doc = json.loads(result)
        assert doc["type"] == "CIMLayoutDocument"
        assert doc["layoutDefinition"]["name"] == "Test"

    def test_page_dimensions(self):
        result = generate_pagx(self.page, [])
        doc = json.loads(result)
        page = doc["layoutDefinition"]["page"]
        assert page["type"] == "CIMPage"
        assert abs(page["width"] - 11.0) < 0.01
        assert abs(page["height"] - 8.5) < 0.01

    def test_map_frame_element(self):
        elems = [{"type": "map_frame", "x": 10, "y": 20, "w": 180, "h": 150}]
        result = generate_pagx(self.page, elems)
        doc = json.loads(result)
        elements = doc["layoutDefinition"]["elements"]
        assert len(elements) == 1
        assert elements[0]["type"] == "CIMMapFrame"
        assert "frame" in elements[0]
        assert "rings" in elements[0]["frame"]

    def test_title_element(self):
        elems = [
            {"type": "title", "x": 10, "y": 5, "w": 100, "h": 15, "text": "My Map"}
        ]
        result = generate_pagx(self.page, elems)
        doc = json.loads(result)
        el = doc["layoutDefinition"]["elements"][0]
        assert el["type"] == "CIMGraphicElement"
        assert el["graphic"]["text"] == "My Map"
        sym = el["graphic"]["symbol"]["symbol"]
        assert sym["fontStyleName"] == "Bold"
        assert sym["horizontalAlignment"] == "Center"

    def test_shape_element(self):
        elems = [
            {
                "type": "shape",
                "x": 10,
                "y": 10,
                "w": 50,
                "h": 30,
                "fillColor": "transparent",
                "strokeColor": "#ff0000",
                "strokeWidth": 2,
            }
        ]
        result = generate_pagx(self.page, elems)
        doc = json.loads(result)
        el = doc["layoutDefinition"]["elements"][0]
        assert el["graphic"]["type"] == "CIMPolygonGraphic"
        sym = el["graphic"]["symbol"]["symbol"]
        # Should have stroke and fill layers
        stroke = [ly for ly in sym["symbolLayers"] if ly["type"] == "CIMSolidStroke"]
        fill = [ly for ly in sym["symbolLayers"] if ly["type"] == "CIMSolidFill"]
        assert len(stroke) == 1
        assert len(fill) == 1
        assert stroke[0]["width"] == 2
        # Fill should be transparent (alpha=0)
        assert fill[0]["color"]["values"][3] == 0

    def test_legend_element(self):
        elems = [{"type": "legend", "x": 200, "y": 50, "w": 60, "h": 80}]
        result = generate_pagx(self.page, elems)
        doc = json.loads(result)
        assert doc["layoutDefinition"]["elements"][0]["type"] == "CIMLegend"

    def test_scale_bar_element(self):
        elems = [{"type": "scale_bar", "x": 10, "y": 190, "w": 100, "h": 15}]
        result = generate_pagx(self.page, elems)
        doc = json.loads(result)
        assert doc["layoutDefinition"]["elements"][0]["type"] == "CIMScaleLine"

    def test_north_arrow_element(self):
        elems = [{"type": "north_arrow", "x": 260, "y": 180, "w": 15, "h": 20}]
        result = generate_pagx(self.page, elems)
        doc = json.loads(result)
        assert doc["layoutDefinition"]["elements"][0]["type"] == "CIMMarkerNorthArrow"
