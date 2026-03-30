"""Generate QGIS .qpt and ArcGIS Pro .pagx layout template files."""

import json
from xml.etree.ElementTree import Element, SubElement, tostring
from xml.dom.minidom import parseString


def _mm(value: float) -> str:
    """Convert mm to string."""
    return f"{value:.2f}"


def _hex_to_rgba(hex_color: str) -> str:
    """Convert hex color like '#1e40af' to QGIS RGBA string like '30,64,175,255'."""
    hex_color = hex_color.lstrip("#")
    if len(hex_color) == 6:
        r, g, b = int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16)
        return f"{r},{g},{b},255"
    return "0,0,0,255"


def _hex_to_rgb_list(hex_color: str) -> list[int]:
    """Convert hex color to [R, G, B] list for ArcGIS CIM."""
    hex_color = hex_color.lstrip("#")
    if len(hex_color) == 6:
        return [int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16)]
    return [0, 0, 0]


_QGIS_HALIGN = {"left": "1", "center": "4", "right": "2"}


def _build_qpt_label(
    layout: Element,
    elem: dict,
    idx: int,
    default_font_size: int = 12,
    default_halign: str = "left",
    default_font_weight: str = "normal",
) -> Element:
    """Build a QgsLayoutItemLabel for title, subtitle, or text elements."""
    x, y = elem.get("x", 0), elem.get("y", 0)
    w, h = elem.get("w", 50), elem.get("h", 20)
    text = elem.get("text", "")
    font_size = elem.get("fontSize", default_font_size)
    halign = _QGIS_HALIGN.get(elem.get("textAlign", default_halign), "1")
    # Qt font weight: 50=normal, 75=bold
    weight_str = elem.get("fontWeight", default_font_weight)
    qt_weight = 75 if weight_str == "bold" else 50

    item = SubElement(layout, "LayoutItem", {
        "type": "65641",  # QgsLayoutItemLabel
        "uuid": f"{{00000000-0000-0000-0000-00000000{idx:04d}}}",
        "position": f"{_mm(x)},{_mm(y)},mm",
        "size": f"{_mm(w)},{_mm(h)},mm",
        "labelText": text,
        "halign": halign,
        "valign": "128",  # Qt::AlignVCenter
    })
    font = SubElement(item, "LabelFont")
    font.set("style", "")
    font.set("description", f"Arial,{font_size},-1,5,{qt_weight},0,0,0,0,0")
    return item


def _build_pagx_text(
    elem_container: Element,
    elem: dict,
    height_pt: float,
    name: str = "Text",
    default_font_size: int = 12,
    default_halign: str = "Left",
    default_font_weight: str = "Regular",
) -> Element:
    """Build a CIMTextGraphic for title, subtitle, or text elements."""
    x = elem.get("x", 0) * 2.8346
    y = elem.get("y", 0) * 2.8346
    text = elem.get("text", "")
    font_size = elem.get("fontSize", default_font_size)

    align_map = {"left": "Left", "center": "Center", "right": "Right"}
    halign = align_map.get(elem.get("textAlign", ""), default_halign)

    weight_str = elem.get("fontWeight", "")
    if weight_str == "bold":
        font_style = "Bold"
    elif weight_str == "normal":
        font_style = "Regular"
    else:
        font_style = default_font_weight

    te = SubElement(elem_container, "CIMGraphicElement")
    SubElement(te, "Name").text = name
    graphic = SubElement(te, "Graphic")
    SubElement(graphic, "xsi:type").text = "typens:CIMTextGraphic"
    SubElement(graphic, "Text").text = text
    symbol = SubElement(graphic, "Symbol")
    SubElement(symbol, "xsi:type").text = "typens:CIMTextSymbol"
    SubElement(symbol, "Height").text = str(font_size)
    SubElement(symbol, "FontStyleName").text = font_style
    SubElement(symbol, "HorizontalAlignment").text = halign
    anchor = SubElement(te, "Anchor")
    SubElement(anchor, "X").text = _mm(x)
    SubElement(anchor, "Y").text = _mm(height_pt - y)
    return te


def generate_qpt(page_config: dict, elements: list[dict], template_name: str = "Map Layout") -> str:
    """Generate QGIS Print Layout Template (.qpt) XML.

    .qpt files are XML templates that can be imported via:
    Project -> Layout Manager -> Add from Template
    """
    width = page_config.get("width", 279.4)  # Letter width in mm
    height = page_config.get("height", 215.9)  # Letter height in mm
    orientation = page_config.get("orientation", "landscape")

    if orientation == "portrait":
        width, height = min(width, height), max(width, height)
    else:
        width, height = max(width, height), min(width, height)

    layout = Element("Layout", {
        "name": template_name,
        "units": "mm",
        "worldFileMap": "",
    })

    # Page settings
    page_collection = SubElement(layout, "PageCollection")
    page = SubElement(page_collection, "LayoutItem", {
        "type": "65638",
        "uuid": "{00000000-0000-0000-0000-000000000001}",
        "position": f"0,0,mm",
        "size": f"{_mm(width)},{_mm(height)},mm",
    })
    SubElement(page, "LayoutObject")

    for elem in elements:
        elem_type = elem.get("type", "")
        x = elem.get("x", 0)
        y = elem.get("y", 0)
        w = elem.get("w", 50)
        h = elem.get("h", 50)

        if elem_type == "map_frame":
            item = SubElement(layout, "LayoutItem", {
                "type": "65639",  # QgsLayoutItemMap
                "uuid": "{00000000-0000-0000-0000-000000000010}",
                "position": f"{_mm(x)},{_mm(y)},mm",
                "size": f"{_mm(w)},{_mm(h)},mm",
                "frame": "true",
                "frameColor": "0,0,0,255",
                "frameWidth": "0.3",
            })
            SubElement(item, "LayoutObject")

        elif elem_type == "title":
            _build_qpt_label(layout, elem, elements.index(elem),
                             default_font_size=24, default_halign="center", default_font_weight="bold")

        elif elem_type == "subtitle":
            _build_qpt_label(layout, elem, elements.index(elem),
                             default_font_size=16, default_halign="center", default_font_weight="normal")

        elif elem_type == "legend":
            item = SubElement(layout, "LayoutItem", {
                "type": "65642",  # QgsLayoutItemLegend
                "uuid": "{00000000-0000-0000-0000-000000000030}",
                "position": f"{_mm(x)},{_mm(y)},mm",
                "size": f"{_mm(w)},{_mm(h)},mm",
                "frame": "true",
                "title": "Legend",
            })
            SubElement(item, "LayoutObject")

        elif elem_type == "scale_bar":
            item = SubElement(layout, "LayoutItem", {
                "type": "65646",  # QgsLayoutItemScaleBar
                "uuid": "{00000000-0000-0000-0000-000000000040}",
                "position": f"{_mm(x)},{_mm(y)},mm",
                "size": f"{_mm(w)},{_mm(h)},mm",
                "style": "Single Box",
                "units": elem.get("units", "meters"),
            })
            SubElement(item, "LayoutObject")

        elif elem_type == "north_arrow":
            item = SubElement(layout, "LayoutItem", {
                "type": "65640",  # QgsLayoutItemPicture
                "uuid": "{00000000-0000-0000-0000-000000000050}",
                "position": f"{_mm(x)},{_mm(y)},mm",
                "size": f"{_mm(w)},{_mm(h)},mm",
                "file": "/sketches/sketches/sketches_north_arrows/sketches_north_arrows/sketches_north_arrows_north_arrow_sketched_6.svg",
                "northMode": "0",
            })
            SubElement(item, "LayoutObject")

        elif elem_type == "logo":
            item = SubElement(layout, "LayoutItem", {
                "type": "65640",  # QgsLayoutItemPicture
                "uuid": "{00000000-0000-0000-0000-000000000060}",
                "position": f"{_mm(x)},{_mm(y)},mm",
                "size": f"{_mm(w)},{_mm(h)},mm",
                "file": "",  # Logo path would be set by user after import
            })
            SubElement(item, "LayoutObject")

        elif elem_type == "text":
            _build_qpt_label(layout, elem, elements.index(elem),
                             default_font_size=12, default_halign="left", default_font_weight="normal")

        elif elem_type == "horizontal_rule":
            thickness = elem.get("thickness", 0.5)
            color = _hex_to_rgba(elem.get("color", "#000000"))
            item = SubElement(layout, "LayoutItem", {
                "type": "65643",  # QgsLayoutItemShape
                "uuid": f"{{00000000-0000-0000-0000-00000000008{elements.index(elem)}}}",
                "position": f"{_mm(x)},{_mm(y)},mm",
                "size": f"{_mm(w)},{_mm(thickness)},mm",
                "shapeType": "0",  # Rectangle
            })
            symbol = SubElement(item, "symbol", {"type": "fill"})
            layer = SubElement(symbol, "layer", {"class": "SimpleFill"})
            SubElement(layer, "prop", {"k": "color", "v": color})

        elif elem_type in ("header_decorator", "footer_decorator"):
            color = _hex_to_rgba(elem.get("color", "#1e40af"))
            item = SubElement(layout, "LayoutItem", {
                "type": "65643",  # QgsLayoutItemShape
                "uuid": f"{{00000000-0000-0000-0000-00000000009{elements.index(elem)}}}",
                "position": f"{_mm(x)},{_mm(y)},mm",
                "size": f"{_mm(w)},{_mm(h)},mm",
                "shapeType": "0",  # Rectangle
            })
            symbol = SubElement(item, "symbol", {"type": "fill"})
            layer = SubElement(symbol, "layer", {"class": "SimpleFill"})
            SubElement(layer, "prop", {"k": "color", "v": color})

    xml_str = tostring(layout, encoding="unicode")
    return parseString(xml_str).toprettyxml(indent="  ")


def generate_pagx(page_config: dict, elements: list[dict], template_name: str = "Map Layout") -> str:
    """Generate ArcGIS Pro Layout (.pagx) XML.

    .pagx files can be imported via:
    Insert -> Import Layout
    """
    width = page_config.get("width", 279.4)
    height = page_config.get("height", 215.9)
    orientation = page_config.get("orientation", "landscape")

    if orientation == "portrait":
        width_pt, height_pt = min(width, height) * 2.8346, max(width, height) * 2.8346
    else:
        width_pt, height_pt = max(width, height) * 2.8346, min(width, height) * 2.8346

    layout = Element("Layout", {
        "xmlns": "http://schemas.esri.com/CIMDocument",
        "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
    })

    page = SubElement(layout, "Page")
    SubElement(page, "Width").text = _mm(width_pt)
    SubElement(page, "Height").text = _mm(height_pt)
    SubElement(page, "Units").text = "Points"

    elem_container = SubElement(layout, "Elements")

    for elem in elements:
        elem_type = elem.get("type", "")
        x = elem.get("x", 0) * 2.8346  # mm to points
        y = elem.get("y", 0) * 2.8346
        w = elem.get("w", 50) * 2.8346
        h = elem.get("h", 50) * 2.8346

        if elem_type == "map_frame":
            mf = SubElement(elem_container, "CIMMapFrame")
            SubElement(mf, "Name").text = "Map Frame"
            anchor = SubElement(mf, "Anchor")
            SubElement(anchor, "X").text = _mm(x)
            SubElement(anchor, "Y").text = _mm(height_pt - y)
            SubElement(mf, "Width").text = _mm(w)
            SubElement(mf, "Height").text = _mm(h)

        elif elem_type == "title":
            _build_pagx_text(elem_container, elem, height_pt,
                             name="Title", default_font_size=24, default_halign="Center", default_font_weight="Bold")

        elif elem_type == "subtitle":
            _build_pagx_text(elem_container, elem, height_pt,
                             name="Subtitle", default_font_size=16, default_halign="Center", default_font_weight="Regular")

        elif elem_type == "text":
            _build_pagx_text(elem_container, elem, height_pt,
                             name="Text", default_font_size=12, default_halign="Left", default_font_weight="Regular")

        elif elem_type == "legend":
            le = SubElement(elem_container, "CIMLegend")
            SubElement(le, "Name").text = "Legend"
            anchor = SubElement(le, "Anchor")
            SubElement(anchor, "X").text = _mm(x)
            SubElement(anchor, "Y").text = _mm(height_pt - y)
            SubElement(le, "Width").text = _mm(w)
            SubElement(le, "Height").text = _mm(h)

        elif elem_type == "scale_bar":
            sb = SubElement(elem_container, "CIMScaleBar")
            SubElement(sb, "Name").text = "Scale Bar"
            anchor = SubElement(sb, "Anchor")
            SubElement(anchor, "X").text = _mm(x)
            SubElement(anchor, "Y").text = _mm(height_pt - y)

        elif elem_type == "north_arrow":
            na = SubElement(elem_container, "CIMNorthArrow")
            SubElement(na, "Name").text = "North Arrow"
            anchor = SubElement(na, "Anchor")
            SubElement(anchor, "X").text = _mm(x)
            SubElement(anchor, "Y").text = _mm(height_pt - y)
            SubElement(na, "Width").text = _mm(w)
            SubElement(na, "Height").text = _mm(h)

        elif elem_type in ("horizontal_rule", "header_decorator", "footer_decorator"):
            color_hex = elem.get("color", "#000000" if elem_type == "horizontal_rule" else "#1e40af")
            rgb = _hex_to_rgb_list(color_hex)
            label = elem_type.replace("_", " ").title()
            # Use actual thickness for horizontal rules
            actual_h = h
            if elem_type == "horizontal_rule":
                thickness = elem.get("thickness", 0.5)
                actual_h = thickness * 2.8346

            ge = SubElement(elem_container, "CIMGraphicElement")
            SubElement(ge, "Name").text = label
            graphic = SubElement(ge, "Graphic")
            SubElement(graphic, "xsi:type").text = "typens:CIMPolygonGraphic"
            polygon = SubElement(graphic, "Polygon")
            SubElement(polygon, "XMin").text = _mm(x)
            SubElement(polygon, "YMin").text = _mm(height_pt - y - actual_h)
            SubElement(polygon, "XMax").text = _mm(x + w)
            SubElement(polygon, "YMax").text = _mm(height_pt - y)
            symbol = SubElement(graphic, "Symbol")
            SubElement(symbol, "xsi:type").text = "typens:CIMPolygonSymbol"
            sym_layer = SubElement(symbol, "SymbolLayer")
            SubElement(sym_layer, "xsi:type").text = "typens:CIMSolidFill"
            color_elem = SubElement(sym_layer, "Color")
            SubElement(color_elem, "R").text = str(rgb[0])
            SubElement(color_elem, "G").text = str(rgb[1])
            SubElement(color_elem, "B").text = str(rgb[2])
            SubElement(color_elem, "A").text = "255"

    xml_str = tostring(layout, encoding="unicode")
    return parseString(xml_str).toprettyxml(indent="  ")
