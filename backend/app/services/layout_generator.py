"""Generate QGIS .qpt and ArcGIS Pro .pagx layout template files."""

from xml.etree.ElementTree import Element, SubElement, tostring
from xml.dom.minidom import parseString


def _mm(value: float) -> str:
    """Convert mm to string."""
    return f"{value:.2f}"


def _hex_to_rgba(hex_color: str) -> str:
    """Convert hex color like '#1e40af' to QGIS RGBA string like '30,64,175,255'."""
    hex_color = hex_color.lstrip("#")
    if len(hex_color) == 6:
        r, g, b = (
            int(hex_color[0:2], 16),
            int(hex_color[2:4], 16),
            int(hex_color[4:6], 16),
        )
        return f"{r},{g},{b},255"
    return "0,0,0,255"


def _hex_to_rgb_list(hex_color: str) -> list[int]:
    """Convert hex color to [R, G, B] list for ArcGIS CIM."""
    hex_color = hex_color.lstrip("#")
    if len(hex_color) == 6:
        return [
            int(hex_color[0:2], 16),
            int(hex_color[2:4], 16),
            int(hex_color[4:6], 16),
        ]
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

    item = SubElement(
        layout,
        "LayoutItem",
        {
            "type": "65641",  # QgsLayoutItemLabel
            "uuid": f"{{00000000-0000-0000-0000-00000000{idx:04d}}}",
            "position": f"{_mm(x)},{_mm(y)},mm",
            "size": f"{_mm(w)},{_mm(h)},mm",
            "labelText": text,
            "halign": halign,
            "valign": "128",  # Qt::AlignVCenter
        },
    )
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


def generate_qpt(
    page_config: dict, elements: list[dict], template_name: str = "Map Layout"
) -> str:
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

    layout = Element(
        "Layout",
        {
            "name": template_name,
            "units": "mm",
            "worldFileMap": "",
        },
    )

    # Page settings
    page_collection = SubElement(layout, "PageCollection")
    page = SubElement(
        page_collection,
        "LayoutItem",
        {
            "type": "65638",
            "uuid": "{00000000-0000-0000-0000-000000000001}",
            "position": "0,0,mm",
            "size": f"{_mm(width)},{_mm(height)},mm",
        },
    )
    SubElement(page, "LayoutObject")

    for elem in elements:
        elem_type = elem.get("type", "")
        x = elem.get("x", 0)
        y = elem.get("y", 0)
        w = elem.get("w", 50)
        h = elem.get("h", 50)

        if elem_type == "map_frame":
            item = SubElement(
                layout,
                "LayoutItem",
                {
                    "type": "65639",  # QgsLayoutItemMap
                    "uuid": "{00000000-0000-0000-0000-000000000010}",
                    "position": f"{_mm(x)},{_mm(y)},mm",
                    "size": f"{_mm(w)},{_mm(h)},mm",
                    "frame": "true",
                    "frameColor": "0,0,0,255",
                    "frameWidth": "0.3",
                },
            )
            SubElement(item, "LayoutObject")

        elif elem_type == "title":
            _build_qpt_label(
                layout,
                elem,
                elements.index(elem),
                default_font_size=24,
                default_halign="center",
                default_font_weight="bold",
            )

        elif elem_type == "subtitle":
            _build_qpt_label(
                layout,
                elem,
                elements.index(elem),
                default_font_size=16,
                default_halign="center",
                default_font_weight="normal",
            )

        elif elem_type == "legend":
            item = SubElement(
                layout,
                "LayoutItem",
                {
                    "type": "65642",  # QgsLayoutItemLegend
                    "uuid": "{00000000-0000-0000-0000-000000000030}",
                    "position": f"{_mm(x)},{_mm(y)},mm",
                    "size": f"{_mm(w)},{_mm(h)},mm",
                    "frame": "true",
                    "title": "Legend",
                },
            )
            SubElement(item, "LayoutObject")

        elif elem_type == "scale_bar":
            item = SubElement(
                layout,
                "LayoutItem",
                {
                    "type": "65646",  # QgsLayoutItemScaleBar
                    "uuid": "{00000000-0000-0000-0000-000000000040}",
                    "position": f"{_mm(x)},{_mm(y)},mm",
                    "size": f"{_mm(w)},{_mm(h)},mm",
                    "style": "Single Box",
                    "units": elem.get("units", "meters"),
                },
            )
            SubElement(item, "LayoutObject")

        elif elem_type == "north_arrow":
            item = SubElement(
                layout,
                "LayoutItem",
                {
                    "type": "65640",  # QgsLayoutItemPicture
                    "uuid": "{00000000-0000-0000-0000-000000000050}",
                    "position": f"{_mm(x)},{_mm(y)},mm",
                    "size": f"{_mm(w)},{_mm(h)},mm",
                    "file": "/sketches/sketches/sketches_north_arrows/sketches_north_arrows/sketches_north_arrows_north_arrow_sketched_6.svg",
                    "northMode": "0",
                },
            )
            SubElement(item, "LayoutObject")

        elif elem_type == "logo":
            item = SubElement(
                layout,
                "LayoutItem",
                {
                    "type": "65640",  # QgsLayoutItemPicture
                    "uuid": "{00000000-0000-0000-0000-000000000060}",
                    "position": f"{_mm(x)},{_mm(y)},mm",
                    "size": f"{_mm(w)},{_mm(h)},mm",
                    "file": "",  # Logo path would be set by user after import
                },
            )
            SubElement(item, "LayoutObject")

        elif elem_type == "text":
            _build_qpt_label(
                layout,
                elem,
                elements.index(elem),
                default_font_size=12,
                default_halign="left",
                default_font_weight="normal",
            )

        elif elem_type == "horizontal_rule":
            thickness = elem.get("thickness", 0.5)
            color = _hex_to_rgba(elem.get("color", "#000000"))
            item = SubElement(
                layout,
                "LayoutItem",
                {
                    "type": "65643",  # QgsLayoutItemShape
                    "uuid": f"{{00000000-0000-0000-0000-00000000008{elements.index(elem)}}}",
                    "position": f"{_mm(x)},{_mm(y)},mm",
                    "size": f"{_mm(w)},{_mm(thickness)},mm",
                    "shapeType": "0",  # Rectangle
                },
            )
            symbol = SubElement(item, "symbol", {"type": "fill"})
            layer = SubElement(symbol, "layer", {"class": "SimpleFill"})
            SubElement(layer, "prop", {"k": "color", "v": color})

        elif elem_type in ("header_decorator", "footer_decorator"):
            color = _hex_to_rgba(elem.get("color", "#1e40af"))
            item = SubElement(
                layout,
                "LayoutItem",
                {
                    "type": "65643",  # QgsLayoutItemShape
                    "uuid": f"{{00000000-0000-0000-0000-00000000009{elements.index(elem)}}}",
                    "position": f"{_mm(x)},{_mm(y)},mm",
                    "size": f"{_mm(w)},{_mm(h)},mm",
                    "shapeType": "0",  # Rectangle
                },
            )
            symbol = SubElement(item, "symbol", {"type": "fill"})
            layer = SubElement(symbol, "layer", {"class": "SimpleFill"})
            SubElement(layer, "prop", {"k": "color", "v": color})

    xml_str = tostring(layout, encoding="unicode")
    return parseString(xml_str).toprettyxml(indent="  ")


def generate_pagx(
    page_config: dict, elements: list[dict], template_name: str = "Map Layout"
) -> str:
    """Generate ArcGIS Pro Layout (.pagx) as JSON (CIMLayoutDocument).

    ArcGIS Pro 3.x uses JSON format for .pagx files. This produces a valid
    CIMLayoutDocument that can be imported via Insert -> Import Layout.
    """
    import json

    MM_TO_INCH = 1.0 / 25.4
    width_mm = page_config.get("width", 279.4)
    height_mm = page_config.get("height", 215.9)
    width_in = width_mm * MM_TO_INCH
    height_in = height_mm * MM_TO_INCH

    def _rect_rings(x_mm: float, y_mm: float, w_mm: float, h_mm: float) -> list:
        """Convert mm position (CSS top-left origin) to ArcGIS rings (bottom-left origin)."""
        x1 = x_mm * MM_TO_INCH
        x2 = (x_mm + w_mm) * MM_TO_INCH
        # Flip Y: CSS y=0 is top, ArcGIS y=0 is bottom
        y_top = height_in - y_mm * MM_TO_INCH
        y_bot = height_in - (y_mm + h_mm) * MM_TO_INCH
        return [[[x1, y_top], [x2, y_top], [x2, y_bot], [x1, y_bot], [x1, y_top]]]

    def _color(hex_str: str, alpha: int = 100) -> dict:
        rgb = _hex_to_rgb_list(hex_str)
        return {"type": "CIMRGBColor", "values": [rgb[0], rgb[1], rgb[2], alpha]}

    def _polygon_symbol(
        fill_hex: str | None = None,
        fill_alpha: int = 100,
        stroke_hex: str = "#000000",
        stroke_width: float = 1,
    ) -> dict:
        layers = []
        # Stroke layer (first in CIM = drawn on top)
        layers.append(
            {
                "type": "CIMSolidStroke",
                "enable": True,
                "capStyle": "Round",
                "joinStyle": "Round",
                "width": stroke_width,
                "color": _color(stroke_hex),
            }
        )
        # Fill layer
        if fill_hex and fill_hex != "transparent":
            layers.append(
                {
                    "type": "CIMSolidFill",
                    "enable": True,
                    "color": _color(fill_hex, fill_alpha),
                }
            )
        else:
            layers.append(
                {
                    "type": "CIMSolidFill",
                    "enable": True,
                    "color": _color("#000000", 0),  # transparent
                }
            )
        return {"type": "CIMPolygonSymbol", "symbolLayers": layers}

    cim_elements = []

    for elem in elements:
        etype = elem.get("type", "")
        x = elem.get("x", 0)
        y = elem.get("y", 0)
        w = elem.get("w", 50)
        h = elem.get("h", 50)
        rings = _rect_rings(x, y, w, h)

        if etype == "map_frame":
            stroke_hex = elem.get("strokeColor", "#000000")
            stroke_w = elem.get("strokeWidth", 1)
            cim_elements.append(
                {
                    "type": "CIMMapFrame",
                    "name": elem.get("text", "Map Frame") or "Map Frame",
                    "visible": True,
                    "anchor": "BottomLeftCorner",
                    "frame": {"rings": rings},
                    "graphicFrame": {
                        "type": "CIMGraphicFrame",
                        "borderSymbol": {
                            "type": "CIMSymbolReference",
                            "symbol": {
                                "type": "CIMLineSymbol",
                                "symbolLayers": [
                                    {
                                        "type": "CIMSolidStroke",
                                        "enable": True,
                                        "width": stroke_w,
                                        "color": _color(stroke_hex),
                                    }
                                ],
                            },
                        },
                    },
                }
            )

        elif etype in ("title", "subtitle", "text"):
            text = elem.get("text", "")
            font_size = elem.get("fontSize", 12 if etype == "text" else 24)
            font_family = elem.get("fontFamily", "Arial")
            font_weight = elem.get(
                "fontWeight", "bold" if etype == "title" else "normal"
            )
            font_style = "Bold" if font_weight == "bold" else "Regular"
            halign_map = {"left": "Left", "center": "Center", "right": "Right"}
            default_align = "center" if etype in ("title", "subtitle") else "left"
            halign = halign_map.get(elem.get("textAlign", default_align), "Left")
            text_color = elem.get("textColor", "#000000")

            cim_elements.append(
                {
                    "type": "CIMGraphicElement",
                    "name": elem.get("text", etype.title())[:50] or etype.title(),
                    "visible": True,
                    "anchor": "TopLeftCorner",
                    "graphic": {
                        "type": "CIMParagraphTextGraphic",
                        "shape": {"rings": rings},
                        "symbol": {
                            "type": "CIMSymbolReference",
                            "symbol": {
                                "type": "CIMTextSymbol",
                                "height": font_size,
                                "fontFamilyName": font_family,
                                "fontStyleName": font_style,
                                "horizontalAlignment": halign,
                                "symbol": {
                                    "type": "CIMPolygonSymbol",
                                    "symbolLayers": [
                                        {
                                            "type": "CIMSolidFill",
                                            "enable": True,
                                            "color": _color(text_color),
                                        }
                                    ],
                                },
                            },
                        },
                        "text": text,
                    },
                }
            )

        elif etype == "legend":
            cim_elements.append(
                {
                    "type": "CIMLegend",
                    "name": "Legend",
                    "visible": True,
                    "anchor": "TopLeftCorner",
                    "frame": {"rings": rings},
                }
            )

        elif etype == "scale_bar":
            cim_elements.append(
                {
                    "type": "CIMScaleLine",
                    "name": "Scale Bar",
                    "visible": True,
                    "anchor": "BottomMidPoint",
                    "frame": {"rings": rings},
                }
            )

        elif etype == "north_arrow":
            cim_elements.append(
                {
                    "type": "CIMMarkerNorthArrow",
                    "name": "North Arrow",
                    "visible": True,
                    "anchor": "CenterPoint",
                    "frame": {"rings": rings},
                }
            )

        elif etype == "shape":
            fill_hex = elem.get("fillColor", "transparent")
            stroke_hex = elem.get("strokeColor", "#000000")
            stroke_w = elem.get("strokeWidth", 1)
            cim_elements.append(
                {
                    "type": "CIMGraphicElement",
                    "name": elem.get("text", "Shape") or "Shape",
                    "visible": True,
                    "anchor": "BottomLeftCorner",
                    "graphic": {
                        "type": "CIMPolygonGraphic",
                        "polygon": {"rings": rings},
                        "symbol": {
                            "type": "CIMSymbolReference",
                            "symbol": _polygon_symbol(
                                fill_hex, 100, stroke_hex, stroke_w
                            ),
                        },
                    },
                }
            )

        elif etype in ("horizontal_rule", "header_decorator", "footer_decorator"):
            color_hex = elem.get(
                "color", "#000000" if etype == "horizontal_rule" else "#1e40af"
            )
            if etype == "horizontal_rule":
                thickness = elem.get("thickness", 0.5)
                h = thickness
            cim_elements.append(
                {
                    "type": "CIMGraphicElement",
                    "name": etype.replace("_", " ").title(),
                    "visible": True,
                    "anchor": "BottomLeftCorner",
                    "graphic": {
                        "type": "CIMPolygonGraphic",
                        "polygon": {"rings": _rect_rings(x, y, w, h)},
                        "symbol": {
                            "type": "CIMSymbolReference",
                            "symbol": _polygon_symbol(color_hex, 100, color_hex, 0.5),
                        },
                    },
                }
            )

    # Build a minimal but valid CIMLayoutDocument.
    # ArcGIS Pro requires mapDefinitions and proper uRI references
    # for elements like CIMMapFrame and CIMLegend to avoid crashes.
    map_uri = "CIMPATH=map/map.json"

    # Link map frame to map definition
    for el in cim_elements:
        if el.get("type") == "CIMMapFrame":
            el["uRI"] = map_uri
            el["view"] = {
                "type": "CIMMapView",
                "viewType": "Map",
                "viewableObjectPath": map_uri,
            }
        elif el.get("type") == "CIMLegend":
            el["mapFrame"] = "Map Frame"

    doc = {
        "type": "CIMLayoutDocument",
        "version": "3.2.0",
        "build": 49743,
        "mapDefinitions": [
            {
                "type": "CIMMap",
                "name": "Map",
                "uRI": map_uri,
                "mapType": "Map",
                "defaultViewingMode": "MapView",
                "defaultExtent": {
                    "xmin": -180,
                    "ymin": -90,
                    "xmax": 180,
                    "ymax": 90,
                    "spatialReference": {"wkid": 4326},
                },
                "spatialReference": {"wkid": 4326},
            }
        ],
        "layoutDefinition": {
            "type": "CIMLayout",
            "name": template_name,
            "uRI": "CIMPATH=layout/layout.json",
            "elements": cim_elements,
            "page": {
                "type": "CIMPage",
                "height": height_in,
                "width": width_in,
                "units": {"uwkid": 109008},
                "showRulers": True,
                "showGuides": True,
                "smallestRulerDivision": 0.01,
            },
        },
    }

    return json.dumps(doc, indent=2)
