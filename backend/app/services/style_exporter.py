"""Export dataset style_config to OGC SLD, ArcGIS Pro LYRX, and QGIS QML formats."""

import json
from xml.etree.ElementTree import Element, SubElement, tostring
from xml.dom.minidom import parseString


def _rgba_to_hex(rgba: list) -> str:
    """Convert [r, g, b, a] to #RRGGBB hex string."""
    r, g, b = int(rgba[0]), int(rgba[1]), int(rgba[2])
    return f"#{r:02x}{g:02x}{b:02x}"


def _rgba_to_esri(rgba: list) -> list:
    """Convert [r, g, b, a] to Esri [r, g, b, a] (0-255)."""
    return [
        int(rgba[0]),
        int(rgba[1]),
        int(rgba[2]),
        int(rgba[3]) if len(rgba) > 3 else 255,
    ]


def _rgba_to_qgis(rgba: list) -> str:
    """Convert [r, g, b, a] to QGIS 'r,g,b,a' string."""
    r, g, b = int(rgba[0]), int(rgba[1]), int(rgba[2])
    a = int(rgba[3]) if len(rgba) > 3 else 255
    return f"{r},{g},{b},{a}"


# ===== SLD Export =====


def generate_sld(
    style_config: dict, layer_name: str = "layer", geometry_type: str | None = None
) -> str:
    """Generate OGC SLD 1.0 XML from style_config."""
    sld = Element(
        "StyledLayerDescriptor",
        {
            "version": "1.0.0",
            "xmlns": "http://www.opengis.net/sld",
            "xmlns:ogc": "http://www.opengis.net/ogc",
            "xmlns:xlink": "http://www.w3.org/1999/xlink",
            "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
        },
    )

    named_layer = SubElement(sld, "NamedLayer")
    SubElement(named_layer, "Name").text = layer_name

    user_style = SubElement(named_layer, "UserStyle")
    SubElement(user_style, "Title").text = layer_name
    feature_type_style = SubElement(user_style, "FeatureTypeStyle")

    mode = style_config.get("mode", "uniform")
    fill_color = style_config.get("fillColor", [0, 128, 255, 180])
    line_color = style_config.get("lineColor", [0, 0, 0, 255])
    line_width = style_config.get("lineWidth", 2)

    if mode == "uniform":
        rule = SubElement(feature_type_style, "Rule")
        SubElement(rule, "Name").text = "Default"
        _add_sld_symbolizer(rule, fill_color, line_color, line_width, geometry_type)

    elif mode == "categorical":
        field = style_config.get("attributeField", "")
        category_colors = style_config.get("categoryColors", {})
        default_color = style_config.get("defaultCategoryColor", fill_color)

        for value, color in category_colors.items():
            rule = SubElement(feature_type_style, "Rule")
            SubElement(rule, "Name").text = str(value)
            ogc_filter = SubElement(rule, "ogc:Filter")
            prop_eq = SubElement(ogc_filter, "ogc:PropertyIsEqualTo")
            SubElement(prop_eq, "ogc:PropertyName").text = field
            SubElement(prop_eq, "ogc:Literal").text = str(value)
            _add_sld_symbolizer(rule, color, line_color, line_width, geometry_type)

        # Default rule for unmatched values
        rule = SubElement(feature_type_style, "Rule")
        SubElement(rule, "Name").text = "Other"
        _el_else = SubElement(rule, "ElseFilter")
        _add_sld_symbolizer(rule, default_color, line_color, line_width, geometry_type)

    elif mode == "graduated":
        field = style_config.get("attributeField", "")
        ramp = style_config.get("colorRamp", {})
        min_val = ramp.get("minValue", 0)
        max_val = ramp.get("maxValue", 100)
        num_classes = ramp.get("numClasses", 5)
        step = (max_val - min_val) / num_classes if num_classes > 0 else 1

        for i in range(num_classes):
            lower = min_val + i * step
            upper = min_val + (i + 1) * step
            fraction = i / max(num_classes - 1, 1)
            # Simple blue-to-red gradient
            r = int(fraction * 255)
            b = int((1 - fraction) * 255)
            color = [r, 50, b, 200]

            rule = SubElement(feature_type_style, "Rule")
            SubElement(rule, "Name").text = f"{lower:.1f} - {upper:.1f}"
            ogc_filter = SubElement(rule, "ogc:Filter")
            between = SubElement(ogc_filter, "ogc:PropertyIsBetween")
            SubElement(between, "ogc:PropertyName").text = field
            lower_el = SubElement(between, "ogc:LowerBoundary")
            SubElement(lower_el, "ogc:Literal").text = str(lower)
            upper_el = SubElement(between, "ogc:UpperBoundary")
            SubElement(upper_el, "ogc:Literal").text = str(upper)
            _add_sld_symbolizer(rule, color, line_color, line_width, geometry_type)

    xml_str = tostring(sld, encoding="unicode")
    return parseString(xml_str).toprettyxml(indent="  ")


def _add_sld_symbolizer(
    rule: Element,
    fill_color: list,
    line_color: list,
    line_width: float,
    geometry_type: str | None,
) -> None:
    """Add appropriate SLD symbolizer based on geometry type."""
    geom = (geometry_type or "").lower()
    if "point" in geom:
        sym = SubElement(rule, "PointSymbolizer")
        graphic = SubElement(sym, "Graphic")
        mark = SubElement(graphic, "Mark")
        SubElement(mark, "WellKnownName").text = "circle"
        fill = SubElement(mark, "Fill")
        SubElement(fill, "CssParameter", {"name": "fill"}).text = _rgba_to_hex(
            fill_color
        )
        stroke = SubElement(mark, "Stroke")
        SubElement(stroke, "CssParameter", {"name": "stroke"}).text = _rgba_to_hex(
            line_color
        )
        SubElement(stroke, "CssParameter", {"name": "stroke-width"}).text = str(
            line_width
        )
        SubElement(graphic, "Size").text = "8"
    elif "line" in geom:
        sym = SubElement(rule, "LineSymbolizer")
        stroke = SubElement(sym, "Stroke")
        SubElement(stroke, "CssParameter", {"name": "stroke"}).text = _rgba_to_hex(
            fill_color
        )
        SubElement(stroke, "CssParameter", {"name": "stroke-width"}).text = str(
            line_width
        )
    else:
        sym = SubElement(rule, "PolygonSymbolizer")
        fill = SubElement(sym, "Fill")
        SubElement(fill, "CssParameter", {"name": "fill"}).text = _rgba_to_hex(
            fill_color
        )
        SubElement(fill, "CssParameter", {"name": "fill-opacity"}).text = str(
            round(fill_color[3] / 255, 2) if len(fill_color) > 3 else 1.0
        )
        stroke = SubElement(sym, "Stroke")
        SubElement(stroke, "CssParameter", {"name": "stroke"}).text = _rgba_to_hex(
            line_color
        )
        SubElement(stroke, "CssParameter", {"name": "stroke-width"}).text = str(
            line_width
        )


# ===== ArcGIS Pro LYRX Export =====


def generate_lyrx(
    style_config: dict, layer_name: str = "layer", geometry_type: str | None = None
) -> str:
    """Generate ArcGIS Pro .lyrx JSON from style_config."""
    mode = style_config.get("mode", "uniform")
    fill_color = style_config.get("fillColor", [0, 128, 255, 180])
    line_color = style_config.get("lineColor", [0, 0, 0, 255])
    line_width = style_config.get("lineWidth", 2)

    if mode == "uniform":
        renderer = {
            "type": "CIMSimpleRenderer",
            "symbol": _lyrx_symbol(fill_color, line_color, line_width, geometry_type),
        }
    elif mode == "categorical":
        field = style_config.get("attributeField", "")
        category_colors = style_config.get("categoryColors", {})
        default_color = style_config.get("defaultCategoryColor", fill_color)
        groups = []
        for value, color in category_colors.items():
            groups.append(
                {
                    "type": "CIMUniqueValueClass",
                    "label": str(value),
                    "symbol": _lyrx_symbol(
                        color, line_color, line_width, geometry_type
                    ),
                    "values": [{"type": "CIMUniqueValue", "fieldValues": [str(value)]}],
                }
            )
        renderer = {
            "type": "CIMUniqueValueRenderer",
            "fields": [field],
            "groups": [{"type": "CIMUniqueValueGroup", "classes": groups}],
            "defaultSymbol": _lyrx_symbol(
                default_color, line_color, line_width, geometry_type
            ),
            "defaultLabel": "Other",
            "useDefaultSymbol": True,
        }
    elif mode == "graduated":
        field = style_config.get("attributeField", "")
        ramp = style_config.get("colorRamp", {})
        min_val = ramp.get("minValue", 0)
        max_val = ramp.get("maxValue", 100)
        num_classes = ramp.get("numClasses", 5)
        step = (max_val - min_val) / num_classes if num_classes > 0 else 1
        breaks = []
        for i in range(num_classes):
            upper = min_val + (i + 1) * step
            fraction = i / max(num_classes - 1, 1)
            r = int(fraction * 255)
            b = int((1 - fraction) * 255)
            color = [r, 50, b, 200]
            breaks.append(
                {
                    "type": "CIMClassBreak",
                    "upperBound": upper,
                    "label": f"{min_val + i * step:.1f} - {upper:.1f}",
                    "symbol": _lyrx_symbol(
                        color, line_color, line_width, geometry_type
                    ),
                }
            )
        renderer = {
            "type": "CIMClassBreaksRenderer",
            "field": field,
            "breaks": breaks,
            "minimumBreak": min_val,
        }
    else:
        renderer = {
            "type": "CIMSimpleRenderer",
            "symbol": _lyrx_symbol(fill_color, line_color, line_width, geometry_type),
        }

    lyrx = {
        "type": "CIMLayerDocument",
        "version": "3.0.0",
        "build": 36057,
        "layers": [f"CIMPATH=map/{layer_name}.json"],
        "layerDefinitions": [
            {
                "type": "CIMFeatureLayer",
                "name": layer_name,
                "renderer": renderer,
            }
        ],
    }

    return json.dumps(lyrx, indent=2)


def _lyrx_symbol(
    fill_color: list, line_color: list, line_width: float, geometry_type: str | None
) -> dict:
    """Build a CIM symbol reference for LYRX."""
    geom = (geometry_type or "").lower()
    fill_esri = _rgba_to_esri(fill_color)
    line_esri = _rgba_to_esri(line_color)

    if "point" in geom:
        return {
            "type": "CIMSymbolReference",
            "symbol": {
                "type": "CIMPointSymbol",
                "symbolLayers": [
                    {
                        "type": "CIMVectorMarker",
                        "size": 8,
                        "frame": {"xmin": -5, "ymin": -5, "xmax": 5, "ymax": 5},
                        "markerGraphics": [
                            {
                                "type": "CIMMarkerGraphic",
                                "geometry": {
                                    "rings": [
                                        [[-5, -5], [-5, 5], [5, 5], [5, -5], [-5, -5]]
                                    ]
                                },
                                "symbol": {
                                    "type": "CIMPolygonSymbol",
                                    "symbolLayers": [
                                        {
                                            "type": "CIMSolidStroke",
                                            "color": {
                                                "type": "CIMRGBColor",
                                                "values": line_esri,
                                            },
                                            "width": line_width,
                                        },
                                        {
                                            "type": "CIMSolidFill",
                                            "color": {
                                                "type": "CIMRGBColor",
                                                "values": fill_esri,
                                            },
                                        },
                                    ],
                                },
                            }
                        ],
                    }
                ],
            },
        }
    elif "line" in geom:
        return {
            "type": "CIMSymbolReference",
            "symbol": {
                "type": "CIMLineSymbol",
                "symbolLayers": [
                    {
                        "type": "CIMSolidStroke",
                        "color": {"type": "CIMRGBColor", "values": fill_esri},
                        "width": line_width,
                    },
                ],
            },
        }
    else:
        return {
            "type": "CIMSymbolReference",
            "symbol": {
                "type": "CIMPolygonSymbol",
                "symbolLayers": [
                    {
                        "type": "CIMSolidStroke",
                        "color": {"type": "CIMRGBColor", "values": line_esri},
                        "width": line_width,
                    },
                    {
                        "type": "CIMSolidFill",
                        "color": {"type": "CIMRGBColor", "values": fill_esri},
                    },
                ],
            },
        }


# ===== QGIS QML Export =====


def generate_qml(
    style_config: dict, layer_name: str = "layer", geometry_type: str | None = None
) -> str:
    """Generate QGIS .qml XML from style_config."""
    qgis = Element("qgis", {"version": "3.34"})
    renderer_el = SubElement(qgis, "renderer-v2")

    mode = style_config.get("mode", "uniform")
    fill_color = style_config.get("fillColor", [0, 128, 255, 180])
    line_color = style_config.get("lineColor", [0, 0, 0, 255])
    line_width = style_config.get("lineWidth", 2)

    if mode == "uniform":
        renderer_el.set("type", "singleSymbol")
        symbols = SubElement(renderer_el, "symbols")
        _add_qml_symbol(symbols, "0", fill_color, line_color, line_width, geometry_type)

    elif mode == "categorical":
        field = style_config.get("attributeField", "")
        category_colors = style_config.get("categoryColors", {})
        _default_color = style_config.get("defaultCategoryColor", fill_color)

        renderer_el.set("type", "categorizedSymbol")
        renderer_el.set("attr", field)

        symbols = SubElement(renderer_el, "symbols")
        categories = SubElement(renderer_el, "categories")

        for idx, (value, color) in enumerate(category_colors.items()):
            sym_id = str(idx)
            _add_qml_symbol(
                symbols, sym_id, color, line_color, line_width, geometry_type
            )
            _cat = SubElement(
                categories,
                "category",
                {
                    "symbol": sym_id,
                    "value": str(value),
                    "label": str(value),
                    "render": "true",
                },
            )

    elif mode == "graduated":
        field = style_config.get("attributeField", "")
        ramp = style_config.get("colorRamp", {})
        min_val = ramp.get("minValue", 0)
        max_val = ramp.get("maxValue", 100)
        num_classes = ramp.get("numClasses", 5)
        step = (max_val - min_val) / num_classes if num_classes > 0 else 1

        renderer_el.set("type", "graduatedSymbol")
        renderer_el.set("attr", field)

        symbols = SubElement(renderer_el, "symbols")
        ranges = SubElement(renderer_el, "ranges")

        for i in range(num_classes):
            lower = min_val + i * step
            upper = min_val + (i + 1) * step
            fraction = i / max(num_classes - 1, 1)
            r = int(fraction * 255)
            b = int((1 - fraction) * 255)
            color = [r, 50, b, 200]

            sym_id = str(i)
            _add_qml_symbol(
                symbols, sym_id, color, line_color, line_width, geometry_type
            )
            SubElement(
                ranges,
                "range",
                {
                    "symbol": sym_id,
                    "lower": str(lower),
                    "upper": str(upper),
                    "label": f"{lower:.1f} - {upper:.1f}",
                    "render": "true",
                },
            )

    xml_str = tostring(qgis, encoding="unicode")
    return parseString(xml_str).toprettyxml(indent="  ")


def _add_qml_symbol(
    symbols: Element,
    sym_id: str,
    fill_color: list,
    line_color: list,
    line_width: float,
    geometry_type: str | None,
) -> None:
    """Add a QGIS symbol element."""
    geom = (geometry_type or "").lower()

    if "point" in geom:
        sym_type = "marker"
    elif "line" in geom:
        sym_type = "line"
    else:
        sym_type = "fill"

    symbol = SubElement(
        symbols,
        "symbol",
        {
            "name": sym_id,
            "type": sym_type,
            "clip_to_extent": "1",
        },
    )

    layer = SubElement(
        symbol,
        "layer",
        {
            "class": (
                "SimpleFill"
                if sym_type == "fill"
                else ("SimpleMarker" if sym_type == "marker" else "SimpleLine")
            ),
            "pass": "0",
            "locked": "0",
        },
    )

    props = {
        "color": _rgba_to_qgis(fill_color),
        "outline_color": _rgba_to_qgis(line_color),
        "outline_width": str(line_width),
        "style": "solid",
        "outline_style": "solid",
    }

    for key, value in props.items():
        SubElement(layer, "prop", {"k": key, "v": value})
