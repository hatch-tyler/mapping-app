"""
ESRI Feature Service REST API endpoints.

Implements the ESRI REST API specification for feature services.
Compatible with ArcGIS Pro, QGIS, and other GIS clients.
"""

import logging
from fastapi import APIRouter, Depends, Query, Response
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services.arcgis.query_handler import ESRIQueryHandler, slugify
from app.services.arcgis.esri_json import build_spatial_reference

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/arcgis/rest/services", tags=["arcgis"])

# CORS headers for ArcGIS client compatibility
CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "*",
}


def json_response(data: dict, status_code: int = 200) -> JSONResponse:
    """Create JSON response with CORS headers and UTF-8 charset for ArcGIS Pro compatibility."""
    headers = {
        **CORS_HEADERS,
        "Content-Type": "application/json; charset=utf-8",
    }
    return JSONResponse(content=data, status_code=status_code, headers=headers)


@router.get("")
async def list_services(
    f: str = Query("json", description="Response format"),
    db: AsyncSession = Depends(get_db),
):
    """List all available feature services."""
    handler = ESRIQueryHandler(db)
    datasets = await handler.get_public_datasets()

    services = []
    for ds in datasets:
        services.append({
            "name": slugify(ds.name),
            "type": "FeatureServer",
        })

    response = {
        "currentVersion": 10.81,
        "services": services,
    }

    return json_response(response)


@router.get("/{service_name}/FeatureServer")
async def get_feature_server(
    service_name: str,
    f: str = Query("json", description="Response format"),
    db: AsyncSession = Depends(get_db),
):
    """Get feature server metadata."""
    try:
        handler = ESRIQueryHandler(db)
        dataset = await handler.get_dataset_by_name(service_name)

        if not dataset:
            return json_response(
                {"error": {"code": 404, "message": f"Service '{service_name}' not found"}},
                status_code=404,
            )

        layer_info = await handler.get_layer_info(dataset)
    except Exception as e:
        logger.exception(f"Error getting feature server info for {service_name}")
        return json_response(
            {"error": {"code": 500, "message": str(e)}},
            status_code=500,
        )

    response = {
        "currentVersion": 10.81,
        "serviceDescription": dataset.description or "",
        "hasVersionedData": False,
        "supportsDisconnectedEditing": False,
        "hasStaticData": True,
        "maxRecordCount": 50000,
        "supportedQueryFormats": "JSON",
        "capabilities": "Query",
        "description": dataset.description or "",
        "copyrightText": "",
        "spatialReference": build_spatial_reference(4326),
        "initialExtent": layer_info.get("extent", {}),
        "fullExtent": layer_info.get("extent", {}),
        "allowGeometryUpdates": False,
        "units": "esriDecimalDegrees",
        "layers": [
            {
                "id": 0,
                "name": dataset.name,
                "parentLayerId": -1,
                "defaultVisibility": True,
                "subLayerIds": None,
                "minScale": 0,
                "maxScale": 0,
                "type": "Feature Layer",
                "geometryType": layer_info.get("geometry_type", "esriGeometryPolygon"),
            }
        ],
        "tables": [],
    }

    return json_response(response)


@router.get("/{service_name}/FeatureServer/{layer_id}")
async def get_layer(
    service_name: str,
    layer_id: int,
    f: str = Query("json", description="Response format"),
    db: AsyncSession = Depends(get_db),
):
    """Get layer metadata."""
    if layer_id != 0:
        return json_response(
            {"error": {"code": 404, "message": f"Layer {layer_id} not found"}},
            status_code=404,
        )

    try:
        handler = ESRIQueryHandler(db)
        dataset = await handler.get_dataset_by_name(service_name)

        if not dataset:
            return json_response(
                {"error": {"code": 404, "message": f"Service '{service_name}' not found"}},
                status_code=404,
            )

        layer_info = await handler.get_layer_info(dataset)
    except Exception as e:
        logger.exception(f"Error getting layer info for {service_name}/{layer_id}")
        return json_response(
            {"error": {"code": 500, "message": str(e)}},
            status_code=500,
        )

    response = {
        "currentVersion": 10.81,
        "id": 0,
        "name": dataset.name,
        "type": "Feature Layer",
        "description": dataset.description or "",
        "copyrightText": "",
        "defaultVisibility": True,
        "editFieldsInfo": None,
        "ownershipBasedAccessControlForFeatures": None,
        "syncCanReturnChanges": False,
        "relationships": [],
        "isDataVersioned": False,
        "supportsRollbackOnFailureParameter": False,
        "archivingInfo": {"supportsQueryWithHistoricMoment": False, "startArchivingMoment": -1},
        "supportsStatistics": False,
        "supportsAdvancedQueries": True,
        "supportsCalculate": False,
        "supportsValidateSql": False,
        "supportsCoordinatesQuantization": False,
        "advancedQueryCapabilities": {
            "useStandardizedQueries": False,
            "supportsStatistics": False,
            "supportsOrderBy": True,
            "supportsDistinct": False,
            "supportsPagination": True,
            "supportsTrueCurve": False,
            "supportsReturningQueryExtent": False,
            "supportsQueryWithDistance": False,
            "supportsSqlExpression": False,
        },
        "geometryType": layer_info.get("geometry_type", "esriGeometryPolygon"),
        "minScale": 0,
        "maxScale": 0,
        "extent": layer_info.get("extent", {}),
        "drawingInfo": {
            "renderer": {
                "type": "simple",
                "symbol": {
                    "type": "esriSFS",
                    "style": "esriSFSSolid",
                    "color": [76, 129, 205, 191],
                    "outline": {
                        "type": "esriSLS",
                        "style": "esriSLSSolid",
                        "color": [0, 0, 0, 255],
                        "width": 0.75,
                    },
                },
            },
            "labelingInfo": None,
        },
        "hasM": False,
        "hasZ": False,
        "allowGeometryUpdates": False,
        "hasAttachments": False,
        "htmlPopupType": "esriServerHTMLPopupTypeNone",
        "objectIdField": "OBJECTID",
        "globalIdField": "",
        "displayField": layer_info["fields"][1]["name"] if len(layer_info.get("fields", [])) > 1 else "OBJECTID",
        "typeIdField": "",
        "subtypeField": "",
        "fields": layer_info.get("fields", []),
        "types": [],
        "templates": [],
        "maxRecordCount": 50000,
        "standardMaxRecordCount": 50000,
        "tileMaxRecordCount": 50000,
        "maxRecordCountFactor": 1,
        "supportedQueryFormats": "JSON",
        "capabilities": "Query",
        "useStandardizedQueries": False,
    }

    return json_response(response)


@router.get("/{service_name}/FeatureServer/{layer_id}/query")
@router.post("/{service_name}/FeatureServer/{layer_id}/query")
async def query_layer(
    service_name: str,
    layer_id: int,
    where: str = Query("1=1", description="SQL WHERE clause"),
    objectIds: str | None = Query(None, description="Comma-separated object IDs"),
    geometry: str | None = Query(None, description="Geometry filter (JSON envelope)"),
    geometryType: str | None = Query(None, description="Geometry type"),
    spatialRel: str = Query("esriSpatialRelIntersects", description="Spatial relationship"),
    outFields: str = Query("*", description="Fields to return"),
    returnGeometry: bool = Query(True, description="Return geometry"),
    outSR: str = Query("4326", description="Output spatial reference (WKID or JSON)"),
    resultOffset: int = Query(0, description="Result offset for pagination"),
    resultRecordCount: int = Query(50000, description="Max records to return"),
    returnCountOnly: bool = Query(False, description="Return count only"),
    returnIdsOnly: bool = Query(False, description="Return IDs only"),
    f: str = Query("json", description="Response format"),
    db: AsyncSession = Depends(get_db),
):
    """Query features from layer."""
    if layer_id != 0:
        return json_response(
            {"error": {"code": 404, "message": f"Layer {layer_id} not found"}},
            status_code=404,
        )

    # Parse outSR - can be integer string or JSON object
    out_sr_wkid = 4326
    try:
        if outSR.startswith("{"):
            import json
            sr_obj = json.loads(outSR)
            out_sr_wkid = sr_obj.get("wkid", 4326)
        else:
            out_sr_wkid = int(outSR)
    except (ValueError, json.JSONDecodeError):
        out_sr_wkid = 4326

    try:
        handler = ESRIQueryHandler(db)
        dataset = await handler.get_dataset_by_name(service_name)

        if not dataset:
            return json_response(
                {"error": {"code": 404, "message": f"Service '{service_name}' not found"}},
                status_code=404,
            )

        result = await handler.execute_query(
            dataset=dataset,
            where=where,
            object_ids=objectIds,
            geometry=geometry,
            geometry_type=geometryType,
            spatial_rel=spatialRel,
            out_fields=outFields,
            return_geometry=returnGeometry,
            out_sr=out_sr_wkid,
            result_offset=resultOffset,
            result_record_count=resultRecordCount,
            return_count_only=returnCountOnly,
            return_ids_only=returnIdsOnly,
        )

        return json_response(result)
    except Exception as e:
        logger.exception(f"Error querying layer {service_name}/{layer_id}")
        return json_response(
            {"error": {"code": 500, "message": str(e)}},
            status_code=500,
        )


@router.options("/{path:path}")
async def options_handler(path: str):
    """Handle OPTIONS requests for CORS."""
    return Response(status_code=200, headers=CORS_HEADERS)
