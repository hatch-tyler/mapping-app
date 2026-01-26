"""
Utilities for converting between GeoJSON and ESRI JSON formats.
"""

from typing import Any

# Geometry type mapping from GeoJSON to ESRI
GEOM_TYPE_MAP = {
    "Point": "esriGeometryPoint",
    "MultiPoint": "esriGeometryMultipoint",
    "LineString": "esriGeometryPolyline",
    "MultiLineString": "esriGeometryPolyline",
    "Polygon": "esriGeometryPolygon",
    "MultiPolygon": "esriGeometryPolygon",
}

# Field type mapping from JSON/Python types to ESRI
FIELD_TYPE_MAP = {
    "string": "esriFieldTypeString",
    "str": "esriFieldTypeString",
    "number": "esriFieldTypeDouble",
    "int": "esriFieldTypeInteger",
    "float": "esriFieldTypeDouble",
    "boolean": "esriFieldTypeSmallInteger",
    "bool": "esriFieldTypeSmallInteger",
    "null": "esriFieldTypeString",
    "object": "esriFieldTypeString",
    "array": "esriFieldTypeString",
}


def geojson_geometry_to_esri(geom: dict | None) -> dict | None:
    """Convert a GeoJSON geometry to ESRI JSON format."""
    if geom is None:
        return None

    geom_type = geom.get("type")
    coords = geom.get("coordinates")

    if not geom_type or coords is None:
        return None

    if geom_type == "Point":
        return {"x": coords[0], "y": coords[1]}

    elif geom_type == "MultiPoint":
        return {"points": coords}

    elif geom_type == "LineString":
        return {"paths": [coords]}

    elif geom_type == "MultiLineString":
        return {"paths": coords}

    elif geom_type == "Polygon":
        # GeoJSON polygons have exterior ring first, then holes
        return {"rings": coords}

    elif geom_type == "MultiPolygon":
        # Flatten all polygons' rings into a single array
        rings = []
        for polygon in coords:
            rings.extend(polygon)
        return {"rings": rings}

    return None


def geojson_to_esri_geometry_type(geom_type: str | None) -> str:
    """Convert GeoJSON geometry type to ESRI geometry type string."""
    if not geom_type:
        return "esriGeometryPolygon"  # Default
    return GEOM_TYPE_MAP.get(geom_type, "esriGeometryPolygon")


def python_type_to_esri_field_type(value: Any) -> str:
    """Infer ESRI field type from Python value."""
    if value is None:
        return "esriFieldTypeString"
    if isinstance(value, bool):
        return "esriFieldTypeSmallInteger"
    if isinstance(value, int):
        return "esriFieldTypeInteger"
    if isinstance(value, float):
        return "esriFieldTypeDouble"
    if isinstance(value, str):
        return "esriFieldTypeString"
    if isinstance(value, (list, dict)):
        return "esriFieldTypeString"
    return "esriFieldTypeString"


def build_field_definition(name: str, field_type: str, alias: str | None = None) -> dict:
    """Build an ESRI field definition object."""
    field = {
        "name": name,
        "type": field_type,
        "alias": alias or name,
    }

    # Add length for string fields
    if field_type == "esriFieldTypeString":
        field["length"] = 4000

    return field


def build_spatial_reference(wkid: int = 4326) -> dict:
    """Build an ESRI spatial reference object."""
    return {
        "wkid": wkid,
        "latestWkid": wkid,
    }


def build_extent(
    xmin: float = -180,
    ymin: float = -90,
    xmax: float = 180,
    ymax: float = 90,
    wkid: int = 4326,
) -> dict:
    """Build an ESRI extent object."""
    return {
        "xmin": xmin,
        "ymin": ymin,
        "xmax": xmax,
        "ymax": ymax,
        "spatialReference": build_spatial_reference(wkid),
    }


def geojson_feature_to_esri(
    feature: dict,
    object_id: int,
    include_geometry: bool = True,
) -> dict:
    """Convert a GeoJSON feature to ESRI JSON feature format."""
    # Reserved field names that should not be overwritten
    reserved_fields = {"OBJECTID", "objectid", "FID", "fid", "OID", "oid", "id", "ID"}

    # Build attributes with OBJECTID
    attributes = {"OBJECTID": object_id}

    # Add properties (skip reserved fields to prevent overwriting OBJECTID)
    props = feature.get("properties", {})
    if props:
        for key, value in props.items():
            # Skip reserved fields
            if key in reserved_fields:
                continue
            # Convert non-primitive types to strings
            if isinstance(value, (list, dict)):
                attributes[key] = str(value) if value else None
            else:
                attributes[key] = value

    esri_feature = {"attributes": attributes}

    # Add geometry if requested
    if include_geometry:
        geom = feature.get("geometry")
        esri_geom = geojson_geometry_to_esri(geom)
        if esri_geom:
            esri_feature["geometry"] = esri_geom

    return esri_feature


def build_query_response(
    features: list[dict],
    fields: list[dict],
    geometry_type: str,
    object_id_field: str = "OBJECTID",
    spatial_reference_wkid: int = 4326,
    exceeded_transfer_limit: bool = False,
) -> dict:
    """Build a complete ESRI query response."""
    return {
        "objectIdFieldName": object_id_field,
        "globalIdFieldName": "",
        "geometryType": geometry_type,
        "spatialReference": build_spatial_reference(spatial_reference_wkid),
        "fields": fields,
        "features": features,
        "exceededTransferLimit": exceeded_transfer_limit,
    }


def build_count_response(count: int) -> dict:
    """Build a count-only query response."""
    return {"count": count}


def build_ids_response(object_ids: list[int], object_id_field: str = "OBJECTID") -> dict:
    """Build an IDs-only query response."""
    return {
        "objectIdFieldName": object_id_field,
        "objectIds": object_ids,
    }
