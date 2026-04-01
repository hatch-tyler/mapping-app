"""Parse QGIS .qpt and ArcGIS Pro .pagx layout template files.

This is the inverse of layout_generator.py. Parsing is best-effort:
unknown elements are skipped and the original file is always preserved.
"""

import logging
from xml.etree.ElementTree import fromstring, Element

logger = logging.getLogger(__name__)

PT_TO_MM = 1.0 / 2.8346

# QGIS halign values -> our textAlign
_QGIS_HALIGN_REV = {"1": "left", "4": "center", "2": "right"}

# QGIS LayoutItem type codes
_QGS_PAGE = "65638"
_QGS_MAP_FRAME = "65639"
_QGS_PICTURE = "65640"
_QGS_LABEL = "65641"
_QGS_LEGEND = "65642"
_QGS_SHAPE = "65643"
_QGS_SCALE_BAR = "65646"


def _parse_position_size(item: Element) -> dict:
    """Extract x, y, w, h from QGIS LayoutItem position/size attrs."""
    pos = item.get("position", "0,0,mm").replace(",mm", "").split(",")
    size = item.get("size", "50,50,mm").replace(",mm", "").split(",")
    return {
        "x": float(pos[0]) if len(pos) >= 1 else 0,
        "y": float(pos[1]) if len(pos) >= 2 else 0,
        "w": float(size[0]) if len(size) >= 1 else 50,
        "h": float(size[1]) if len(size) >= 2 else 50,
    }


def _parse_qpt_label(item: Element) -> dict:
    """Parse a QgsLayoutItemLabel into a text element."""
    elem = _parse_position_size(item)
    elem["text"] = item.get("labelText", "")

    # Font info from LabelFont description: "Arial,size,-1,5,weight,..."
    font_el = item.find("LabelFont")
    font_size = 12
    font_weight = "normal"
    if font_el is not None:
        desc = font_el.get("description", "")
        parts = desc.split(",")
        if len(parts) >= 2:
            try:
                font_size = int(parts[1])
            except ValueError:
                pass
        if len(parts) >= 5:
            try:
                font_weight = "bold" if int(parts[4]) >= 75 else "normal"
            except ValueError:
                pass
    elem["fontSize"] = font_size
    elem["fontWeight"] = font_weight

    # Alignment
    halign = item.get("halign", "1")
    elem["textAlign"] = _QGIS_HALIGN_REV.get(halign, "left")

    # Determine type by font size
    if font_size >= 20:
        elem["type"] = "title"
    elif font_size >= 14:
        elem["type"] = "subtitle"
    else:
        elem["type"] = "text"

    return elem


def _rgba_to_hex(rgba_str: str) -> str:
    """Convert '30,64,175,255' to '#1e40af'."""
    parts = rgba_str.split(",")
    if len(parts) >= 3:
        try:
            r, g, b = int(parts[0]), int(parts[1]), int(parts[2])
            return f"#{r:02x}{g:02x}{b:02x}"
        except ValueError:
            pass
    return "#000000"


def parse_qpt(xml_content: str) -> tuple[dict, list[dict]]:
    """Parse QGIS Print Layout Template (.qpt) XML into page_config and elements."""
    root = fromstring(xml_content)

    # Page dimensions
    width, height = 279.4, 215.9
    page_item = root.find(".//PageCollection/LayoutItem")
    if page_item is not None:
        size_str = page_item.get("size", "").replace(",mm", "")
        parts = size_str.split(",")
        if len(parts) >= 2:
            try:
                width, height = float(parts[0]), float(parts[1])
            except ValueError:
                pass

    orientation = "landscape" if width >= height else "portrait"
    page_config = {"width": width, "height": height, "orientation": orientation}

    # Elements
    elements: list[dict] = []
    for item in root.findall(".//LayoutItem"):
        item_type = item.get("type", "")

        if item_type == _QGS_PAGE:
            continue

        try:
            if item_type == _QGS_MAP_FRAME:
                elem = _parse_position_size(item)
                elem["type"] = "map_frame"
                elements.append(elem)

            elif item_type == _QGS_LABEL:
                elements.append(_parse_qpt_label(item))

            elif item_type == _QGS_LEGEND:
                elem = _parse_position_size(item)
                elem["type"] = "legend"
                elements.append(elem)

            elif item_type == _QGS_SCALE_BAR:
                elem = _parse_position_size(item)
                elem["type"] = "scale_bar"
                elem["units"] = item.get("units", "meters")
                elements.append(elem)

            elif item_type == _QGS_PICTURE:
                elem = _parse_position_size(item)
                if item.get("northMode") is not None:
                    elem["type"] = "north_arrow"
                else:
                    elem["type"] = "logo"
                elements.append(elem)

            elif item_type == _QGS_SHAPE:
                elem = _parse_position_size(item)
                # Extract color
                color_prop = item.find(".//prop[@k='color']")
                color = "#000000"
                if color_prop is not None:
                    color = _rgba_to_hex(color_prop.get("v", "0,0,0,255"))
                elem["color"] = color

                # Classify: thin = horizontal_rule, else decorator by y position
                if elem["h"] < 3:
                    elem["type"] = "horizontal_rule"
                    elem["thickness"] = elem["h"]
                elif elem["y"] < height * 0.2:
                    elem["type"] = "header_decorator"
                else:
                    elem["type"] = "footer_decorator"
                elements.append(elem)

            else:
                logger.debug("Skipping unknown QGIS element type: %s", item_type)

        except Exception as e:
            logger.warning("Failed to parse QGIS element type=%s: %s", item_type, e)

    return page_config, elements


def parse_pagx(content: str) -> tuple[dict, list[dict]]:
    """Parse ArcGIS Pro Layout (.pagx) into page_config and elements.

    Modern .pagx files are JSON (CIMLayoutDocument). Older ones may be XML.
    This function detects the format and handles both.
    """
    import json

    content = content.strip()

    # Detect JSON vs XML
    if content.startswith("{"):
        return _parse_pagx_json(json.loads(content))
    else:
        return _parse_pagx_xml(content)


def _parse_pagx_json(data: dict) -> tuple[dict, list[dict]]:
    """Parse JSON-format .pagx (ArcGIS Pro 3.x+)."""
    INCH_TO_MM = 25.4

    # Build lookup for embedded binary data (images, etc.)
    binary_lookup: dict[str, str] = {}
    for ref in data.get("binaryReferences", []):
        uri = ref.get("uRI", "")
        ref_data = ref.get("data", "")
        if uri and ref_data:
            binary_lookup[uri] = ref_data

    layout = data.get("layoutDefinition", {})
    page = layout.get("page", {})

    # Page dimensions (in inches -> mm)
    width_in = page.get("width", 11)
    height_in = page.get("height", 8.5)
    width_mm = width_in * INCH_TO_MM
    height_mm = height_in * INCH_TO_MM
    orientation = "landscape" if width_mm >= height_mm else "portrait"

    page_config = {
        "width": round(width_mm, 1),
        "height": round(height_mm, 1),
        "orientation": orientation,
    }

    elements: list[dict] = []
    import re

    for el in layout.get("elements", []):
        try:
            el_type = el.get("type", "")
            name = el.get("name", "")

            pos = _pagx_json_position(el, INCH_TO_MM, height_mm)

            if el_type == "CIMMapFrame":
                elem = {**pos, "type": "map_frame"}
                # Extract border from graphicFrame
                gf = el.get("graphicFrame", {})
                border_sym = gf.get("borderSymbol", {}).get("symbol", {})
                stroke = _extract_cim_stroke(border_sym)
                if stroke:
                    elem.update(stroke)
                elements.append(elem)

            elif el_type in ("CIMLegend",):
                elem = {**pos, "type": "legend"}
                elements.append(elem)

            elif el_type in ("CIMScaleBar", "CIMScaleLine"):
                elem = {**pos, "type": "scale_bar"}
                elements.append(elem)

            elif el_type in ("CIMNorthArrow", "CIMMarkerNorthArrow"):
                elem = {**pos, "type": "north_arrow"}
                elements.append(elem)

            elif el_type == "CIMGraphicElement":
                graphic = el.get("graphic", {})
                gtype = graphic.get("type", "")

                if gtype in ("CIMTextGraphic", "CIMParagraphTextGraphic"):
                    text = graphic.get("text", "")
                    clean_text = re.sub(r"<[^>]+>", "", text).strip()
                    elem = {
                        **pos,
                        "type": "text",
                        "text": clean_text[:200] if clean_text else name,
                    }
                    # Extract full text symbol properties
                    text_sym = graphic.get("symbol", {}).get("symbol", {})
                    _apply_cim_text_symbol(elem, text_sym)
                    elements.append(elem)

                elif gtype == "CIMPictureGraphic":
                    elem = {**pos, "type": "image", "text": name}
                    ref_uri = graphic.get("referenceURI", "")
                    if ref_uri and ref_uri in binary_lookup:
                        ext = ref_uri.rsplit(".", 1)[-1].lower()
                        mime = {
                            "png": "image/png",
                            "jpg": "image/jpeg",
                            "jpeg": "image/jpeg",
                        }.get(ext, "image/png")
                        elem["imageData"] = (
                            f"data:{mime};base64,{binary_lookup[ref_uri]}"
                        )
                    elements.append(elem)

                elif gtype == "CIMPolygonGraphic":
                    elem = {**pos, "type": "shape", "text": name}
                    # Extract fill and stroke from polygon symbol
                    poly_sym = graphic.get("symbol", {}).get("symbol", {})
                    _apply_cim_polygon_symbol(elem, poly_sym)
                    elements.append(elem)

                else:
                    logger.debug("Skipping unknown graphic type: %s", gtype)

            else:
                logger.debug("Skipping unknown ArcGIS element: %s", el_type)

        except Exception as e:
            logger.warning("Failed to parse ArcGIS element %s: %s", el.get("type"), e)

    # Clamp elements to page bounds; skip entirely off-page elements
    clamped: list[dict] = []
    for elem in elements:
        x, y, w, h = elem["x"], elem["y"], elem["w"], elem["h"]
        # Skip elements entirely outside the page
        if x >= width_mm or y >= height_mm or x + w <= 0 or y + h <= 0:
            continue
        # Clamp to page bounds
        if x < 0:
            w += x
            x = 0
        if y < 0:
            h += y
            y = 0
        if x + w > width_mm:
            w = width_mm - x
        if y + h > height_mm:
            h = height_mm - y
        elem["x"] = round(x, 1)
        elem["y"] = round(y, 1)
        elem["w"] = round(max(w, 1), 1)
        elem["h"] = round(max(h, 1), 1)
        clamped.append(elem)

    return page_config, clamped


def _pagx_json_position(el: dict, inch_to_mm: float, page_height_mm: float) -> dict:
    """Extract x, y, w, h from a JSON .pagx element.

    ArcGIS uses bottom-left origin (Y up); CSS uses top-left origin (Y down).
    We flip Y by computing: css_y = page_height - arcgis_top_edge.

    Position data can be in multiple locations depending on element type:
    1. el.frame.rings — CIMMapFrame, CIMLegend, CIMScaleLine, CIMNorthArrow
    2. el.graphic.shape.rings — CIMGraphicElement (text, polygon)
    3. el.graphic.box — CIMPictureGraphic (logo/image)
    4. el.graphic.shape.x/.y — point-based CIMTextGraphic
    """

    def _from_rings(rings: list) -> dict | None:
        if not rings or not rings[0]:
            return None
        coords = rings[0]
        xs = [p[0] for p in coords]
        ys = [p[1] for p in coords]
        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)
        return {
            "x": round(min_x * inch_to_mm, 1),
            "y": round(page_height_mm - max_y * inch_to_mm, 1),
            "w": round((max_x - min_x) * inch_to_mm, 1),
            "h": round((max_y - min_y) * inch_to_mm, 1),
        }

    # 1. el.frame.rings (primary elements like map frame, legend)
    result = _from_rings(el.get("frame", {}).get("rings", []))
    if result:
        return result

    # 2a. el.graphic.shape.rings (text graphic elements)
    graphic = el.get("graphic", {})
    result = _from_rings(graphic.get("shape", {}).get("rings", []))
    if result:
        return result

    # 2b. el.graphic.polygon.rings (CIMPolygonGraphic — neatline, title block)
    result = _from_rings(graphic.get("polygon", {}).get("rings", []))
    if result:
        return result

    # 3. el.graphic.box (picture/logo elements)
    box = graphic.get("box", {})
    if "xmin" in box and "ymin" in box and "xmax" in box and "ymax" in box:
        return {
            "x": round(box["xmin"] * inch_to_mm, 1),
            "y": round(page_height_mm - box["ymax"] * inch_to_mm, 1),
            "w": round((box["xmax"] - box["xmin"]) * inch_to_mm, 1),
            "h": round((box["ymax"] - box["ymin"]) * inch_to_mm, 1),
        }

    # 4. el.graphic.shape.x/.y (point-based text)
    shape = graphic.get("shape", {})
    if "x" in shape and "y" in shape:
        return {
            "x": round(shape["x"] * inch_to_mm, 1),
            "y": round(page_height_mm - shape["y"] * inch_to_mm, 1),
            "w": 50,
            "h": 10,
        }

    # 5. Fallback
    return {"x": 0, "y": 0, "w": 25, "h": 25}


def _cim_color_to_css(color_obj: dict | None) -> str | None:
    """Convert CIM color object to CSS rgba string."""
    if not color_obj:
        return None
    values = color_obj.get("values", [])
    if len(values) < 3:
        return None
    r, g, b = int(values[0]), int(values[1]), int(values[2])
    # CIM alpha is 0-100 (0=transparent, 100=opaque)
    a = values[3] / 100.0 if len(values) >= 4 else 1.0
    if a == 0:
        return "transparent"
    if a >= 1.0:
        return f"#{r:02x}{g:02x}{b:02x}"
    return f"rgba({r},{g},{b},{a:.2f})"


def _extract_cim_stroke(symbol: dict) -> dict:
    """Extract stroke properties from a CIM line or polygon symbol."""
    result: dict = {}
    for layer in symbol.get("symbolLayers", []):
        if layer.get("type") == "CIMSolidStroke" and layer.get("enable", True):
            color = _cim_color_to_css(layer.get("color"))
            if color and color != "transparent":
                result["strokeColor"] = color
            width = layer.get("width", 1)
            result["strokeWidth"] = round(float(width), 1)
            break
    return result


def _apply_cim_polygon_symbol(elem: dict, symbol: dict) -> None:
    """Extract fill and stroke from a CIMPolygonSymbol into element dict."""
    for layer in symbol.get("symbolLayers", []):
        layer_type = layer.get("type", "")
        if not layer.get("enable", True):
            continue
        if layer_type == "CIMSolidFill":
            color = _cim_color_to_css(layer.get("color"))
            elem["fillColor"] = color or "transparent"
        elif layer_type == "CIMSolidStroke":
            color = _cim_color_to_css(layer.get("color"))
            if color and color != "transparent":
                elem["strokeColor"] = color
            elem["strokeWidth"] = round(float(layer.get("width", 1)), 1)


def _apply_cim_text_symbol(elem: dict, symbol: dict) -> None:
    """Extract font properties from a CIMTextSymbol into element dict."""
    # Font size (height in points)
    height = symbol.get("height")
    if height:
        elem["fontSize"] = int(round(float(height)))

    # Font family
    family = symbol.get("fontFamilyName")
    if family:
        elem["fontFamily"] = family

    # Font weight from style name
    style = symbol.get("fontStyleName", "").lower()
    if "bold" in style:
        elem["fontWeight"] = "bold"

    # Text alignment
    halign = symbol.get("horizontalAlignment", "").lower()
    if halign in ("left", "center", "right"):
        elem["textAlign"] = halign

    # Text color — nested in symbol.symbol.symbolLayers[].CIMSolidFill.color
    inner_sym = symbol.get("symbol", {})
    for layer in inner_sym.get("symbolLayers", []):
        if layer.get("type") == "CIMSolidFill" and layer.get("enable", True):
            color = _cim_color_to_css(layer.get("color"))
            if color and color != "transparent":
                elem["textColor"] = color
            break


def _parse_pagx_xml(xml_content: str) -> tuple[dict, list[dict]]:
    """Parse XML-format .pagx (older ArcGIS Pro versions)."""
    root = fromstring(xml_content)

    ns = ""
    if root.tag.startswith("{"):
        ns = root.tag.split("}")[0] + "}"

    width_pt, height_pt = 279.4 * 2.8346, 215.9 * 2.8346
    page = root.find(f"{ns}Page")
    if page is not None:
        w_el = page.find(f"{ns}Width")
        h_el = page.find(f"{ns}Height")
        if w_el is not None and w_el.text:
            width_pt = float(w_el.text)
        if h_el is not None and h_el.text:
            height_pt = float(h_el.text)

    width_mm = width_pt * PT_TO_MM
    height_mm = height_pt * PT_TO_MM
    orientation = "landscape" if width_mm >= height_mm else "portrait"
    page_config = {
        "width": round(width_mm, 1),
        "height": round(height_mm, 1),
        "orientation": orientation,
    }

    elements: list[dict] = []
    elem_container = root.find(f"{ns}Elements")
    if elem_container is None:
        return page_config, elements

    for child in elem_container:
        tag = child.tag.replace(ns, "")
        try:
            if tag == "CIMMapFrame":
                elem = _parse_pagx_positioned(child, ns, height_pt)
                elem["type"] = "map_frame"
                w_el = child.find(f"{ns}Width")
                h_el = child.find(f"{ns}Height")
                if w_el is not None and w_el.text:
                    elem["w"] = round(float(w_el.text) * PT_TO_MM, 1)
                if h_el is not None and h_el.text:
                    elem["h"] = round(float(h_el.text) * PT_TO_MM, 1)
                elements.append(elem)

            elif tag == "CIMGraphicElement":
                graphic = child.find(f"{ns}Graphic")
                if graphic is None:
                    continue
                xsi_ns = "{http://www.w3.org/2001/XMLSchema-instance}"
                gtype_el = graphic.find(f"{xsi_ns}type")
                if gtype_el is None:
                    gtype_el = graphic.find(f"{ns}xsi:type")
                if gtype_el is None:
                    gtype_el = graphic.find("xsi:type")
                gtype = gtype_el.text if gtype_el is not None else ""

                if "CIMTextGraphic" in gtype:
                    elem = _parse_pagx_text(child, graphic, ns, height_pt)
                    elements.append(elem)
                elif "CIMPolygonGraphic" in gtype:
                    elem = _parse_pagx_polygon(child, graphic, ns, height_pt, height_mm)
                    elements.append(elem)

            elif tag == "CIMLegend":
                elem = _parse_pagx_positioned(child, ns, height_pt)
                elem["type"] = "legend"
                w_el = child.find(f"{ns}Width")
                h_el = child.find(f"{ns}Height")
                if w_el is not None and w_el.text:
                    elem["w"] = round(float(w_el.text) * PT_TO_MM, 1)
                if h_el is not None and h_el.text:
                    elem["h"] = round(float(h_el.text) * PT_TO_MM, 1)
                elements.append(elem)

            elif tag in ("CIMScaleBar", "CIMScaleLine"):
                elem = _parse_pagx_positioned(child, ns, height_pt)
                elem["type"] = "scale_bar"
                elements.append(elem)

            elif tag in ("CIMNorthArrow", "CIMMarkerNorthArrow"):
                elem = _parse_pagx_positioned(child, ns, height_pt)
                elem["type"] = "north_arrow"
                w_el = child.find(f"{ns}Width")
                h_el = child.find(f"{ns}Height")
                if w_el is not None and w_el.text:
                    elem["w"] = round(float(w_el.text) * PT_TO_MM, 1)
                if h_el is not None and h_el.text:
                    elem["h"] = round(float(h_el.text) * PT_TO_MM, 1)
                elements.append(elem)

            else:
                logger.debug("Skipping unknown ArcGIS element: %s", tag)

        except Exception as e:
            logger.warning("Failed to parse ArcGIS element %s: %s", tag, e)

    return page_config, elements


def _parse_pagx_positioned(elem: Element, ns: str, height_pt: float) -> dict:
    """Extract x, y from Anchor element (points -> mm, flip Y)."""
    anchor = elem.find(f"{ns}Anchor")
    x_mm, y_mm = 0.0, 0.0
    if anchor is not None:
        x_el = anchor.find(f"{ns}X")
        y_el = anchor.find(f"{ns}Y")
        if x_el is not None and x_el.text:
            x_mm = round(float(x_el.text) * PT_TO_MM, 1)
        if y_el is not None and y_el.text:
            y_mm = round((height_pt - float(y_el.text)) * PT_TO_MM, 1)
    return {"x": x_mm, "y": y_mm, "w": 50, "h": 50}


def _parse_pagx_text(
    container: Element, graphic: Element, ns: str, height_pt: float
) -> dict:
    """Parse CIMTextGraphic into a text element."""
    elem = _parse_pagx_positioned(container, ns, height_pt)

    text_el = graphic.find(f"{ns}Text")
    elem["text"] = text_el.text if text_el is not None else ""

    symbol = graphic.find(f"{ns}Symbol")
    font_size = 12
    font_weight = "normal"
    text_align = "left"
    if symbol is not None:
        h_el = symbol.find(f"{ns}Height")
        if h_el is not None and h_el.text:
            try:
                font_size = int(float(h_el.text))
            except ValueError:
                pass
        style_el = symbol.find(f"{ns}FontStyleName")
        if style_el is not None and style_el.text:
            font_weight = "bold" if "Bold" in style_el.text else "normal"
        align_el = symbol.find(f"{ns}HorizontalAlignment")
        if align_el is not None and align_el.text:
            text_align = align_el.text.lower()

    elem["fontSize"] = font_size
    elem["fontWeight"] = font_weight
    elem["textAlign"] = text_align

    if font_size >= 20:
        elem["type"] = "title"
    elif font_size >= 14:
        elem["type"] = "subtitle"
    else:
        elem["type"] = "text"

    return elem


def _parse_pagx_polygon(
    container: Element,
    graphic: Element,
    ns: str,
    height_pt: float,
    height_mm: float,
) -> dict:
    """Parse CIMPolygonGraphic into a shape element."""
    polygon = graphic.find(f"{ns}Polygon")
    x, y, w, h = 0.0, 0.0, 50.0, 10.0
    if polygon is not None:
        xmin = float(polygon.findtext(f"{ns}XMin", "0"))
        ymin = float(polygon.findtext(f"{ns}YMin", "0"))
        xmax = float(polygon.findtext(f"{ns}XMax", "50"))
        ymax = float(polygon.findtext(f"{ns}YMax", "10"))
        x = round(xmin * PT_TO_MM, 1)
        y = round((height_pt - ymax) * PT_TO_MM, 1)
        w = round((xmax - xmin) * PT_TO_MM, 1)
        h = round((ymax - ymin) * PT_TO_MM, 1)

    # Extract color
    color = "#000000"
    color_el = graphic.find(f".//{ns}Color") or graphic.find(".//Color")
    if color_el is not None:
        r = color_el.findtext(f"{ns}R", "0") or color_el.findtext("R", "0")
        g = color_el.findtext(f"{ns}G", "0") or color_el.findtext("G", "0")
        b = color_el.findtext(f"{ns}B", "0") or color_el.findtext("B", "0")
        try:
            color = f"#{int(r):02x}{int(g):02x}{int(b):02x}"
        except ValueError:
            pass

    elem = {"x": x, "y": y, "w": w, "h": h, "color": color}

    if h < 3:
        elem["type"] = "horizontal_rule"
        elem["thickness"] = h
    elif y < height_mm * 0.2:
        elem["type"] = "header_decorator"
    else:
        elem["type"] = "footer_decorator"

    return elem


def parse_template_file(content: str, fmt: str) -> tuple[dict, list[dict]]:
    """Parse a template file into (page_config, elements).

    Args:
        content: Raw file content (XML for .qpt, JSON or XML for .pagx)
        fmt: 'qpt' or 'pagx'

    Returns:
        Tuple of (page_config dict, elements list)

    Raises:
        ValueError: If format is unsupported or content is invalid
    """
    if fmt == "qpt":
        return parse_qpt(content)
    elif fmt == "pagx":
        return parse_pagx(content)
    else:
        raise ValueError(f"Unsupported template format: {fmt}")
