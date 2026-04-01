"""Tests for template parser service (round-trip with layout_generator)."""

from app.services.layout_generator import generate_qpt, generate_pagx
from app.services.template_parser import parse_qpt, parse_pagx, parse_template_file


class TestParseQpt:
    def setup_method(self):
        self.page = {"width": 279.4, "height": 215.9, "orientation": "landscape"}
        self.elements = [
            {"type": "map_frame", "x": 25.4, "y": 38, "w": 180, "h": 150},
            {
                "type": "title",
                "x": 25.4,
                "y": 12.7,
                "w": 200,
                "h": 19,
                "text": "My Map",
                "fontSize": 24,
                "textAlign": "center",
                "fontWeight": "bold",
            },
            {
                "type": "subtitle",
                "x": 25.4,
                "y": 31.75,
                "w": 200,
                "h": 12.7,
                "text": "A Subtitle",
                "fontSize": 16,
                "textAlign": "center",
                "fontWeight": "normal",
            },
            {"type": "legend", "x": 200, "y": 38, "w": 50, "h": 76},
            {"type": "scale_bar", "x": 25.4, "y": 190, "w": 76.2, "h": 12.7},
            {"type": "north_arrow", "x": 240, "y": 160, "w": 19, "h": 25.4},
        ]

    def test_round_trip_page_config(self):
        xml = generate_qpt(self.page, self.elements)
        page_config, _ = parse_qpt(xml)
        assert page_config["orientation"] == "landscape"
        assert abs(page_config["width"] - 279.4) < 1
        assert abs(page_config["height"] - 215.9) < 1

    def test_round_trip_element_count(self):
        xml = generate_qpt(self.page, self.elements)
        _, elements = parse_qpt(xml)
        assert len(elements) == len(self.elements)

    def test_round_trip_element_types(self):
        xml = generate_qpt(self.page, self.elements)
        _, elements = parse_qpt(xml)
        types = [e["type"] for e in elements]
        assert "map_frame" in types
        assert "title" in types
        assert "subtitle" in types
        assert "legend" in types
        assert "scale_bar" in types
        assert "north_arrow" in types

    def test_round_trip_title_text(self):
        xml = generate_qpt(self.page, self.elements)
        _, elements = parse_qpt(xml)
        title = next(e for e in elements if e["type"] == "title")
        assert title["text"] == "My Map"
        assert title["fontSize"] == 24
        assert title["fontWeight"] == "bold"
        assert title["textAlign"] == "center"

    def test_round_trip_positions(self):
        xml = generate_qpt(self.page, self.elements)
        _, elements = parse_qpt(xml)
        map_frame = next(e for e in elements if e["type"] == "map_frame")
        assert abs(map_frame["x"] - 25.4) < 0.1
        assert abs(map_frame["y"] - 38) < 0.1

    def test_portrait_orientation(self):
        page = {"width": 215.9, "height": 279.4, "orientation": "portrait"}
        xml = generate_qpt(page, [])
        page_config, _ = parse_qpt(xml)
        assert page_config["orientation"] == "portrait"

    def test_empty_elements(self):
        xml = generate_qpt(self.page, [])
        page_config, elements = parse_qpt(xml)
        assert elements == []
        assert page_config["width"] > 0

    def test_malformed_xml_raises(self):
        try:
            parse_qpt("not xml at all")
            assert False, "Should have raised"
        except Exception:
            pass


class TestParsePagx:
    def setup_method(self):
        self.page = {"width": 279.4, "height": 215.9, "orientation": "landscape"}
        self.elements = [
            {"type": "map_frame", "x": 25.4, "y": 38, "w": 180, "h": 150},
            {
                "type": "title",
                "x": 25.4,
                "y": 12.7,
                "w": 200,
                "h": 19,
                "text": "My Map",
                "fontSize": 24,
                "textAlign": "center",
                "fontWeight": "bold",
            },
            {"type": "legend", "x": 200, "y": 38, "w": 50, "h": 76},
            {"type": "scale_bar", "x": 25.4, "y": 190, "w": 76.2, "h": 12.7},
            {"type": "north_arrow", "x": 240, "y": 160, "w": 19, "h": 25.4},
        ]

    def test_round_trip_page_config(self):
        xml = generate_pagx(self.page, self.elements)
        page_config, _ = parse_pagx(xml)
        assert page_config["orientation"] == "landscape"
        assert abs(page_config["width"] - 279.4) < 1
        assert abs(page_config["height"] - 215.9) < 1

    def test_round_trip_element_count(self):
        xml = generate_pagx(self.page, self.elements)
        _, elements = parse_pagx(xml)
        assert len(elements) == len(self.elements)

    def test_round_trip_element_types(self):
        result = generate_pagx(self.page, self.elements)
        _, elements = parse_pagx(result)
        types = [e["type"] for e in elements]
        assert "map_frame" in types
        # pagx parser maps all CIMParagraphTextGraphic to "text" (not "title")
        assert "text" in types
        assert "legend" in types
        assert "scale_bar" in types
        assert "north_arrow" in types

    def test_round_trip_title_text(self):
        result = generate_pagx(self.page, self.elements)
        _, elements = parse_pagx(result)
        text_elems = [e for e in elements if e["type"] == "text"]
        title = next(e for e in text_elems if "My Map" in e.get("text", ""))
        assert title["text"] == "My Map"
        assert title["fontSize"] == 24
        assert title["fontWeight"] == "bold"

    def test_empty_elements(self):
        result = generate_pagx(self.page, [])
        _, elements = parse_pagx(result)
        assert elements == []


class TestParseTemplateFile:
    def test_qpt_dispatch(self):
        xml = generate_qpt(
            {"width": 279.4, "height": 215.9, "orientation": "landscape"}, []
        )
        page_config, elements = parse_template_file(xml, "qpt")
        assert page_config["orientation"] == "landscape"

    def test_pagx_dispatch(self):
        xml = generate_pagx(
            {"width": 279.4, "height": 215.9, "orientation": "landscape"}, []
        )
        page_config, elements = parse_template_file(xml, "pagx")
        assert page_config["orientation"] == "landscape"

    def test_unsupported_format_raises(self):
        try:
            parse_template_file("<xml/>", "pdf")
            assert False, "Should have raised"
        except ValueError as e:
            assert "Unsupported" in str(e)
