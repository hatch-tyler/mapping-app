"""Tests for layout generator service."""

import pytest
from xml.etree.ElementTree import fromstring

from app.services.layout_generator import (
    generate_qpt,
    generate_pagx,
    _hex_to_rgba,
    _hex_to_rgb_list,
    _mm,
)


class TestHelpers:
    def test_mm_formats_float(self):
        assert _mm(10.0) == "10.00"
        assert _mm(279.4) == "279.40"

    def test_hex_to_rgba_valid(self):
        assert _hex_to_rgba("#ff0000") == "255,0,0,255"
        assert _hex_to_rgba("#1e40af") == "30,64,175,255"
        assert _hex_to_rgba("#000000") == "0,0,0,255"

    def test_hex_to_rgba_without_hash(self):
        assert _hex_to_rgba("ff0000") == "255,0,0,255"

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
        elems = [{"type": "title", "x": 10, "y": 5, "w": 100, "h": 15, "text": "My Map", "fontSize": 18}]
        result = generate_qpt(self.page, elems)
        assert 'labelText="My Map"' in result
        assert "Arial,18" in result

    def test_legend_element(self):
        elems = [{"type": "legend", "x": 200, "y": 20, "w": 60, "h": 80}]
        result = generate_qpt(self.page, elems)
        assert 'type="65642"' in result

    def test_scale_bar_element(self):
        elems = [{"type": "scale_bar", "x": 10, "y": 190, "w": 60, "h": 10, "units": "feet"}]
        result = generate_qpt(self.page, elems)
        assert 'type="65646"' in result
        assert 'units="feet"' in result

    def test_north_arrow_element(self):
        elems = [{"type": "north_arrow", "x": 240, "y": 100, "w": 15, "h": 20}]
        result = generate_qpt(self.page, elems)
        assert 'type="65640"' in result

    def test_text_element(self):
        elems = [{"type": "text", "x": 10, "y": 10, "w": 50, "h": 10, "text": "Hello"}]
        result = generate_qpt(self.page, elems)
        assert 'labelText="Hello"' in result

    def test_horizontal_rule_element(self):
        elems = [{"type": "horizontal_rule", "x": 10, "y": 100, "w": 200, "h": 1, "thickness": 0.5, "color": "#ff0000"}]
        result = generate_qpt(self.page, elems)
        assert 'shapeType="0"' in result
        assert "255,0,0,255" in result

    def test_header_decorator_element(self):
        elems = [{"type": "header_decorator", "x": 0, "y": 0, "w": 279.4, "h": 15, "color": "#1e40af"}]
        result = generate_qpt(self.page, elems)
        assert "30,64,175,255" in result

    def test_footer_decorator_element(self):
        elems = [{"type": "footer_decorator", "x": 0, "y": 200, "w": 279.4, "h": 15, "color": "#1e40af"}]
        result = generate_qpt(self.page, elems)
        assert "30,64,175,255" in result

    def test_portrait_orientation_swaps_dimensions(self):
        page = {"width": 215.9, "height": 279.4, "orientation": "portrait"}
        result = generate_qpt(page, [])
        root = fromstring(result)
        page_item = root.find(".//PageCollection/LayoutItem")
        size = page_item.get("size")
        # Portrait: width should be smaller
        w, h = size.replace(",mm", "").split(",")[:2]
        assert float(w) < float(h)


class TestGeneratePagx:
    NS = "{http://schemas.esri.com/CIMDocument}"

    def setup_method(self):
        self.page = {"width": 279.4, "height": 215.9, "orientation": "landscape"}

    def test_produces_valid_xml(self):
        result = generate_pagx(self.page, [], "Test")
        root = fromstring(result)
        assert root.tag == f"{self.NS}Layout"

    def test_page_dimensions(self):
        result = generate_pagx(self.page, [])
        root = fromstring(result)
        page = root.find(f"{self.NS}Page")
        assert page is not None

    def test_map_frame_element(self):
        elems = [{"type": "map_frame", "x": 10, "y": 20, "w": 180, "h": 150}]
        result = generate_pagx(self.page, elems)
        assert "CIMMapFrame" in result

    def test_title_element(self):
        elems = [{"type": "title", "x": 10, "y": 5, "w": 100, "h": 15, "text": "My Map"}]
        result = generate_pagx(self.page, elems)
        assert "My Map" in result

    def test_legend_element(self):
        elems = [{"type": "legend", "x": 200, "y": 20, "w": 60, "h": 80}]
        result = generate_pagx(self.page, elems)
        assert "CIMLegend" in result

    def test_scale_bar_element(self):
        elems = [{"type": "scale_bar", "x": 10, "y": 190, "w": 60, "h": 10}]
        result = generate_pagx(self.page, elems)
        assert "CIMScaleBar" in result

    def test_north_arrow_element(self):
        elems = [{"type": "north_arrow", "x": 240, "y": 100, "w": 15, "h": 20}]
        result = generate_pagx(self.page, elems)
        assert "CIMNorthArrow" in result

    def test_horizontal_rule_element(self):
        elems = [{"type": "horizontal_rule", "x": 10, "y": 100, "w": 200, "h": 1, "color": "#ff0000"}]
        result = generate_pagx(self.page, elems)
        assert "Horizontal Rule" in result
        assert "<R>255</R>" in result

    def test_header_decorator_element(self):
        elems = [{"type": "header_decorator", "x": 0, "y": 0, "w": 279, "h": 15, "color": "#1e40af"}]
        result = generate_pagx(self.page, elems)
        assert "Header Decorator" in result

    def test_footer_decorator_element(self):
        elems = [{"type": "footer_decorator", "x": 0, "y": 200, "w": 279, "h": 15, "color": "#1e40af"}]
        result = generate_pagx(self.page, elems)
        assert "Footer Decorator" in result

    def test_all_element_types_together(self):
        elems = [
            {"type": "map_frame", "x": 10, "y": 20, "w": 180, "h": 150},
            {"type": "title", "x": 10, "y": 5, "w": 180, "h": 15, "text": "Title"},
            {"type": "legend", "x": 200, "y": 20, "w": 60, "h": 80},
            {"type": "scale_bar", "x": 10, "y": 190, "w": 60, "h": 10},
            {"type": "north_arrow", "x": 240, "y": 100, "w": 15, "h": 20},
            {"type": "horizontal_rule", "x": 10, "y": 100, "w": 200, "h": 1},
            {"type": "header_decorator", "x": 0, "y": 0, "w": 279, "h": 15},
            {"type": "footer_decorator", "x": 0, "y": 200, "w": 279, "h": 15},
        ]
        qpt = generate_qpt(self.page, elems, "Full Template")
        pagx = generate_pagx(self.page, elems, "Full Template")
        # Both should parse without error
        fromstring(qpt)
        fromstring(pagx)
