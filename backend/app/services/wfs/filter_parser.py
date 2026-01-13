"""OGC Filter Encoding parser for WFS."""

from typing import Any
import defusedxml.ElementTree as ET


# OGC Filter namespace
OGC_NS = "http://www.opengis.net/ogc"
GML_NS = "http://www.opengis.net/gml"


def parse_ogc_filter(filter_xml: str) -> tuple[str | None, dict[str, Any]]:
    """
    Parse OGC Filter Encoding XML and return SQL WHERE clause.

    Returns:
        tuple: (sql_clause, params) or (None, {}) if parsing fails
    """
    try:
        root = ET.fromstring(filter_xml)
        return _parse_element(root, 0)
    except Exception:
        return None, {}


def _parse_element(elem: Any, param_idx: int) -> tuple[str | None, dict[str, Any]]:
    """Parse a filter element recursively."""
    tag = _local_name(elem)

    if tag == "Filter":
        # Process first child
        if len(elem) > 0:
            return _parse_element(elem[0], param_idx)
        return None, {}

    # Logical operators
    if tag == "And":
        clauses = []
        params = {}
        for child in elem:
            clause, child_params = _parse_element(child, param_idx + len(params))
            if clause:
                clauses.append(clause)
                params.update(child_params)
        if clauses:
            return f"({' AND '.join(clauses)})", params
        return None, {}

    if tag == "Or":
        clauses = []
        params = {}
        for child in elem:
            clause, child_params = _parse_element(child, param_idx + len(params))
            if clause:
                clauses.append(clause)
                params.update(child_params)
        if clauses:
            return f"({' OR '.join(clauses)})", params
        return None, {}

    if tag == "Not":
        if len(elem) > 0:
            clause, params = _parse_element(elem[0], param_idx)
            if clause:
                return f"NOT ({clause})", params
        return None, {}

    # Comparison operators
    if tag == "PropertyIsEqualTo":
        return _parse_comparison(elem, "=", param_idx)

    if tag == "PropertyIsNotEqualTo":
        return _parse_comparison(elem, "!=", param_idx)

    if tag == "PropertyIsLessThan":
        return _parse_comparison(elem, "<", param_idx)

    if tag == "PropertyIsGreaterThan":
        return _parse_comparison(elem, ">", param_idx)

    if tag == "PropertyIsLessThanOrEqualTo":
        return _parse_comparison(elem, "<=", param_idx)

    if tag == "PropertyIsGreaterThanOrEqualTo":
        return _parse_comparison(elem, ">=", param_idx)

    if tag == "PropertyIsLike":
        return _parse_like(elem, param_idx)

    if tag == "PropertyIsNull":
        prop_name = _get_property_name(elem)
        if prop_name:
            return f"(properties->>'{prop_name}') IS NULL", {}
        return None, {}

    if tag == "PropertyIsBetween":
        return _parse_between(elem, param_idx)

    # Spatial operators
    if tag == "BBOX":
        return _parse_bbox(elem, param_idx)

    if tag == "Intersects":
        return _parse_spatial(elem, "ST_Intersects", param_idx)

    if tag == "Within":
        return _parse_spatial(elem, "ST_Within", param_idx)

    if tag == "Contains":
        return _parse_spatial(elem, "ST_Contains", param_idx)

    # Feature ID
    if tag == "FeatureId" or tag == "GmlObjectId":
        fid = elem.get("fid") or elem.get(f"{{{GML_NS}}}id")
        if fid:
            try:
                # Extract numeric ID from "gis:uuid.123" format
                id_val = int(fid.split(".")[-1])
                param_name = f"fid_{param_idx}"
                return f"id = :{param_name}", {param_name: id_val}
            except (ValueError, IndexError):
                pass
        return None, {}

    return None, {}


def _local_name(elem: Any) -> str:
    """Get local name without namespace."""
    tag = elem.tag
    if "}" in tag:
        return tag.split("}")[1]
    return tag


def _get_property_name(elem: Any) -> str | None:
    """Extract PropertyName from element."""
    prop_elem = elem.find(f".//{{{OGC_NS}}}PropertyName")
    if prop_elem is None:
        prop_elem = elem.find(".//PropertyName")
    if prop_elem is not None and prop_elem.text:
        return prop_elem.text.strip()
    return None


def _get_literal_value(elem: Any) -> str | None:
    """Extract Literal value from element."""
    lit_elem = elem.find(f".//{{{OGC_NS}}}Literal")
    if lit_elem is None:
        lit_elem = elem.find(".//Literal")
    if lit_elem is not None and lit_elem.text is not None:
        return lit_elem.text.strip()
    return None


def _parse_comparison(elem: Any, operator: str, param_idx: int) -> tuple[str | None, dict[str, Any]]:
    """Parse a comparison operator element."""
    prop_name = _get_property_name(elem)
    literal = _get_literal_value(elem)

    if prop_name and literal is not None:
        param_name = f"p_{param_idx}"
        # Use JSONB accessor for properties
        return f"(properties->>'{prop_name}') {operator} :{param_name}", {param_name: literal}

    return None, {}


def _parse_like(elem: Any, param_idx: int) -> tuple[str | None, dict[str, Any]]:
    """Parse PropertyIsLike operator."""
    prop_name = _get_property_name(elem)
    literal = _get_literal_value(elem)

    if prop_name and literal is not None:
        # Get wildcard characters (defaults from OGC spec)
        wild_card = elem.get("wildCard", "*")
        single_char = elem.get("singleChar", "?")
        escape_char = elem.get("escapeChar", "\\")

        # Convert to SQL LIKE pattern
        pattern = literal
        pattern = pattern.replace(escape_char + wild_card, "\x00")
        pattern = pattern.replace(escape_char + single_char, "\x01")
        pattern = pattern.replace(wild_card, "%")
        pattern = pattern.replace(single_char, "_")
        pattern = pattern.replace("\x00", wild_card)
        pattern = pattern.replace("\x01", single_char)

        param_name = f"p_{param_idx}"

        # Case sensitivity
        match_case = elem.get("matchCase", "true").lower() == "true"
        if match_case:
            return f"(properties->>'{prop_name}') LIKE :{param_name}", {param_name: pattern}
        else:
            return f"(properties->>'{prop_name}') ILIKE :{param_name}", {param_name: pattern}

    return None, {}


def _parse_between(elem: Any, param_idx: int) -> tuple[str | None, dict[str, Any]]:
    """Parse PropertyIsBetween operator."""
    prop_name = _get_property_name(elem)

    lower_elem = elem.find(f".//{{{OGC_NS}}}LowerBoundary")
    if lower_elem is None:
        lower_elem = elem.find(".//LowerBoundary")

    upper_elem = elem.find(f".//{{{OGC_NS}}}UpperBoundary")
    if upper_elem is None:
        upper_elem = elem.find(".//UpperBoundary")

    if prop_name and lower_elem is not None and upper_elem is not None:
        lower_lit = lower_elem.find(f".//{{{OGC_NS}}}Literal")
        if lower_lit is None:
            lower_lit = lower_elem.find(".//Literal")

        upper_lit = upper_elem.find(f".//{{{OGC_NS}}}Literal")
        if upper_lit is None:
            upper_lit = upper_elem.find(".//Literal")

        if lower_lit is not None and upper_lit is not None:
            lower_param = f"lower_{param_idx}"
            upper_param = f"upper_{param_idx}"
            return (
                f"(properties->>'{prop_name}')::numeric BETWEEN :{lower_param} AND :{upper_param}",
                {lower_param: lower_lit.text, upper_param: upper_lit.text},
            )

    return None, {}


def _parse_bbox(elem: Any, param_idx: int) -> tuple[str | None, dict[str, Any]]:
    """Parse BBOX spatial operator."""
    # Look for Envelope
    envelope = elem.find(f".//{{{GML_NS}}}Envelope")
    if envelope is None:
        envelope = elem.find(".//Envelope")

    if envelope is not None:
        lower = envelope.find(f".//{{{GML_NS}}}lowerCorner")
        if lower is None:
            lower = envelope.find(".//lowerCorner")

        upper = envelope.find(f".//{{{GML_NS}}}upperCorner")
        if upper is None:
            upper = envelope.find(".//upperCorner")

        if lower is not None and upper is not None and lower.text and upper.text:
            try:
                minx, miny = map(float, lower.text.strip().split())
                maxx, maxy = map(float, upper.text.strip().split())

                return (
                    f"ST_Intersects(geom, ST_MakeEnvelope(:bbox_minx_{param_idx}, :bbox_miny_{param_idx}, :bbox_maxx_{param_idx}, :bbox_maxy_{param_idx}, 4326))",
                    {
                        f"bbox_minx_{param_idx}": minx,
                        f"bbox_miny_{param_idx}": miny,
                        f"bbox_maxx_{param_idx}": maxx,
                        f"bbox_maxy_{param_idx}": maxy,
                    },
                )
            except (ValueError, IndexError):
                pass

    return None, {}


def _parse_spatial(elem: Any, func_name: str, param_idx: int) -> tuple[str | None, dict[str, Any]]:
    """Parse spatial operators (Intersects, Within, Contains)."""
    # For now, support Envelope only
    envelope = elem.find(f".//{{{GML_NS}}}Envelope")
    if envelope is None:
        envelope = elem.find(".//Envelope")

    if envelope is not None:
        lower = envelope.find(f".//{{{GML_NS}}}lowerCorner")
        if lower is None:
            lower = envelope.find(".//lowerCorner")

        upper = envelope.find(f".//{{{GML_NS}}}upperCorner")
        if upper is None:
            upper = envelope.find(".//upperCorner")

        if lower is not None and upper is not None and lower.text and upper.text:
            try:
                minx, miny = map(float, lower.text.strip().split())
                maxx, maxy = map(float, upper.text.strip().split())

                return (
                    f"{func_name}(geom, ST_MakeEnvelope(:sp_minx_{param_idx}, :sp_miny_{param_idx}, :sp_maxx_{param_idx}, :sp_maxy_{param_idx}, 4326))",
                    {
                        f"sp_minx_{param_idx}": minx,
                        f"sp_miny_{param_idx}": miny,
                        f"sp_maxx_{param_idx}": maxx,
                        f"sp_maxy_{param_idx}": maxy,
                    },
                )
            except (ValueError, IndexError):
                pass

    return None, {}
