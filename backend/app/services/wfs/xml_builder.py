"""XML/GML building utilities for WFS responses."""

from typing import Any
from lxml import etree

# WFS Namespaces
NAMESPACES = {
    "wfs": "http://www.opengis.net/wfs",
    "ogc": "http://www.opengis.net/ogc",
    "ows": "http://www.opengis.net/ows",
    "gml": "http://www.opengis.net/gml",
    "xlink": "http://www.w3.org/1999/xlink",
    "xsi": "http://www.w3.org/2001/XMLSchema-instance",
    "xs": "http://www.w3.org/2001/XMLSchema",
    "gis": "http://localhost:8000/gis",
}

# Schema locations
SCHEMA_LOCATIONS = {
    "wfs": "http://www.opengis.net/wfs http://schemas.opengis.net/wfs/1.1.0/wfs.xsd",
}


def create_element(tag: str, namespace: str | None = None, **attribs) -> etree._Element:
    """Create an XML element with optional namespace."""
    if namespace:
        nsmap = {None: NAMESPACES.get(namespace, namespace)}
        elem = etree.Element(f"{{{NAMESPACES.get(namespace, namespace)}}}{tag}", nsmap=nsmap)
    else:
        elem = etree.Element(tag)

    for key, value in attribs.items():
        if value is not None:
            elem.set(key, str(value))

    return elem


def ns_tag(namespace: str, tag: str) -> str:
    """Create a namespaced tag string."""
    ns_uri = NAMESPACES.get(namespace, namespace)
    return f"{{{ns_uri}}}{tag}"


def add_text_element(parent: etree._Element, tag: str, text: str, namespace: str | None = None) -> etree._Element:
    """Add a text element to a parent."""
    if namespace:
        elem = etree.SubElement(parent, ns_tag(namespace, tag))
    else:
        elem = etree.SubElement(parent, tag)
    elem.text = text
    return elem


def to_xml_string(root: etree._Element, pretty_print: bool = True) -> str:
    """Convert an element tree to XML string."""
    return etree.tostring(
        root,
        pretty_print=pretty_print,
        xml_declaration=True,
        encoding="UTF-8",
    ).decode("utf-8")


def build_exception_report(code: str, message: str, locator: str | None = None) -> str:
    """Build an OWS ExceptionReport XML response."""
    nsmap = {
        "ows": NAMESPACES["ows"],
    }

    root = etree.Element(
        ns_tag("ows", "ExceptionReport"),
        nsmap=nsmap,
        version="1.1.0",
    )

    exception = etree.SubElement(root, ns_tag("ows", "Exception"))
    exception.set("exceptionCode", code)
    if locator:
        exception.set("locator", locator)

    text = etree.SubElement(exception, ns_tag("ows", "ExceptionText"))
    text.text = message

    return to_xml_string(root)


def _is_lat_lon_order(srs: str) -> bool:
    """Check if SRS requires lat/lon (y,x) coordinate order.

    URN format (urn:ogc:def:crs:EPSG::4326) requires lat/lon order.
    Simple format (EPSG:4326) uses lon/lat order for compatibility.
    """
    return srs.startswith("urn:") and "4326" in srs


def _format_coord(x: float, y: float, swap: bool) -> str:
    """Format a coordinate pair, optionally swapping order."""
    if swap:
        return f"{y} {x}"
    return f"{x} {y}"


def _format_coords(coords: list, swap: bool) -> str:
    """Format a list of coordinates."""
    return " ".join(_format_coord(c[0], c[1], swap) for c in coords)


def geometry_to_gml(geojson_geom: dict, srs: str = "EPSG:4326") -> etree._Element:
    """Convert GeoJSON geometry to GML 3.1.1 element.

    Handles coordinate order based on SRS:
    - URN format (urn:ogc:def:crs:EPSG::4326): lat/lon (y,x) order
    - Simple format (EPSG:4326): lon/lat (x,y) order
    """
    geom_type = geojson_geom.get("type")
    coordinates = geojson_geom.get("coordinates", [])
    swap = _is_lat_lon_order(srs)

    gml_ns = NAMESPACES["gml"]
    nsmap = {"gml": gml_ns}

    def make_pos_list(coords: list) -> etree._Element:
        """Create a posList element with proper attributes."""
        pos_list = etree.Element(ns_tag("gml", "posList"))
        pos_list.set("srsDimension", "2")
        pos_list.text = _format_coords(coords, swap)
        return pos_list

    if geom_type == "Point":
        elem = etree.Element(ns_tag("gml", "Point"), nsmap=nsmap, srsName=srs)
        pos = etree.SubElement(elem, ns_tag("gml", "pos"))
        pos.set("srsDimension", "2")
        pos.text = _format_coord(coordinates[0], coordinates[1], swap)

    elif geom_type == "LineString":
        elem = etree.Element(ns_tag("gml", "LineString"), nsmap=nsmap, srsName=srs)
        pos_list = make_pos_list(coordinates)
        elem.append(pos_list)

    elif geom_type == "Polygon":
        # Use MultiSurface wrapper for ArcGIS Pro compatibility
        elem = etree.Element(ns_tag("gml", "MultiSurface"), nsmap=nsmap, srsName=srs)
        member = etree.SubElement(elem, ns_tag("gml", "surfaceMember"))
        poly = etree.SubElement(member, ns_tag("gml", "Polygon"))
        exterior = etree.SubElement(poly, ns_tag("gml", "exterior"))
        ring = etree.SubElement(exterior, ns_tag("gml", "LinearRing"))
        ring.append(make_pos_list(coordinates[0]))

        # Handle interior rings (holes)
        for hole in coordinates[1:]:
            interior = etree.SubElement(poly, ns_tag("gml", "interior"))
            hole_ring = etree.SubElement(interior, ns_tag("gml", "LinearRing"))
            hole_ring.append(make_pos_list(hole))

    elif geom_type == "MultiPoint":
        elem = etree.Element(ns_tag("gml", "MultiPoint"), nsmap=nsmap, srsName=srs)
        for point in coordinates:
            member = etree.SubElement(elem, ns_tag("gml", "pointMember"))
            pt = etree.SubElement(member, ns_tag("gml", "Point"))
            pos = etree.SubElement(pt, ns_tag("gml", "pos"))
            pos.set("srsDimension", "2")
            pos.text = _format_coord(point[0], point[1], swap)

    elif geom_type == "MultiLineString":
        elem = etree.Element(ns_tag("gml", "MultiLineString"), nsmap=nsmap, srsName=srs)
        for line in coordinates:
            member = etree.SubElement(elem, ns_tag("gml", "lineStringMember"))
            ls = etree.SubElement(member, ns_tag("gml", "LineString"))
            ls.append(make_pos_list(line))

    elif geom_type == "MultiPolygon":
        # Use MultiSurface for ArcGIS Pro compatibility
        elem = etree.Element(ns_tag("gml", "MultiSurface"), nsmap=nsmap, srsName=srs)
        for polygon in coordinates:
            member = etree.SubElement(elem, ns_tag("gml", "surfaceMember"))
            poly = etree.SubElement(member, ns_tag("gml", "Polygon"))
            exterior = etree.SubElement(poly, ns_tag("gml", "exterior"))
            ring = etree.SubElement(exterior, ns_tag("gml", "LinearRing"))
            ring.append(make_pos_list(polygon[0]))

            # Handle interior rings in multipolygon
            for hole in polygon[1:]:
                interior = etree.SubElement(poly, ns_tag("gml", "interior"))
                hole_ring = etree.SubElement(interior, ns_tag("gml", "LinearRing"))
                hole_ring.append(make_pos_list(hole))
    else:
        # Fallback: generic geometry
        elem = etree.Element(ns_tag("gml", "Geometry"), nsmap=nsmap, srsName=srs)

    return elem


def gml_to_wkt(gml_element: etree._Element) -> str:
    """Convert GML element to WKT string for PostGIS."""
    # Extract tag without namespace
    tag = etree.QName(gml_element).localname

    if tag == "Point":
        pos = gml_element.find(".//{http://www.opengis.net/gml}pos")
        if pos is not None and pos.text:
            coords = pos.text.strip().split()
            return f"POINT({coords[0]} {coords[1]})"

    elif tag == "LineString":
        pos_list = gml_element.find(".//{http://www.opengis.net/gml}posList")
        if pos_list is not None and pos_list.text:
            coords = pos_list.text.strip().split()
            points = [f"{coords[i]} {coords[i+1]}" for i in range(0, len(coords), 2)]
            return f"LINESTRING({', '.join(points)})"

    elif tag == "Polygon":
        rings = []
        # Exterior ring
        exterior = gml_element.find(".//{http://www.opengis.net/gml}exterior")
        if exterior is not None:
            pos_list = exterior.find(".//{http://www.opengis.net/gml}posList")
            if pos_list is not None and pos_list.text:
                coords = pos_list.text.strip().split()
                points = [f"{coords[i]} {coords[i+1]}" for i in range(0, len(coords), 2)]
                rings.append(f"({', '.join(points)})")

        # Interior rings
        for interior in gml_element.findall(".//{http://www.opengis.net/gml}interior"):
            pos_list = interior.find(".//{http://www.opengis.net/gml}posList")
            if pos_list is not None and pos_list.text:
                coords = pos_list.text.strip().split()
                points = [f"{coords[i]} {coords[i+1]}" for i in range(0, len(coords), 2)]
                rings.append(f"({', '.join(points)})")

        return f"POLYGON({', '.join(rings)})"

    return ""
