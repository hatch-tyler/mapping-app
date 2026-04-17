"""WMS (Web Map Service) endpoint for raster datasets.

OGC WMS 1.3.0 implementation supporting GetCapabilities and GetMap.
"""

import asyncio
import logging
from pathlib import Path

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services.wms import (
    build_capabilities_xml,
    build_exception_xml,
    get_public_raster_datasets,
    get_raster_dataset_by_id,
)
from app.services.raster_render import render_bbox

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/wms", tags=["wms"])

WMS_XML = "application/xml; charset=utf-8"
WMS_CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "*",
}


def _get_param(
    params: dict[str, str], name: str, default: str | None = None
) -> str | None:
    """Case-insensitive parameter lookup (OGC WMS spec requires this)."""
    if name in params:
        return params[name]
    name_lower = name.lower()
    for key, value in params.items():
        if key.lower() == name_lower:
            return value
    return default


@router.options("")
async def wms_options():
    return Response(status_code=204, headers=WMS_CORS)


@router.get("")
async def wms_handler(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """OGC WMS 1.3.0 endpoint. Dispatches to GetCapabilities or GetMap."""
    params = dict(request.query_params)
    wms_request = (_get_param(params, "request") or "").lower()

    if wms_request == "getcapabilities":
        return await _get_capabilities(request, db)
    elif wms_request == "getmap":
        return await _get_map(params, db)
    else:
        # Default: return capabilities
        return await _get_capabilities(request, db)


async def _get_capabilities(request: Request, db: AsyncSession) -> Response:
    """Handle WMS GetCapabilities."""
    datasets = await get_public_raster_datasets(db)
    base_url = str(request.base_url).rstrip("/")
    xml = build_capabilities_xml(datasets, base_url)
    return Response(content=xml, media_type=WMS_XML, headers=WMS_CORS)


async def _get_map(params: dict[str, str], db: AsyncSession) -> Response:
    """Handle WMS GetMap - render a raster image for a bbox."""
    layers = _get_param(params, "layers", "")
    if not layers:
        xml = build_exception_xml("LayerNotDefined", "LAYERS parameter is required")
        return Response(
            content=xml, media_type=WMS_XML, status_code=400, headers=WMS_CORS
        )

    # Use first layer only
    layer_id = layers.split(",")[0].strip()
    dataset = await get_raster_dataset_by_id(db, layer_id)
    if not dataset:
        xml = build_exception_xml("LayerNotDefined", f"Layer '{layer_id}' not found")
        return Response(
            content=xml, media_type=WMS_XML, status_code=404, headers=WMS_CORS
        )

    if not dataset.file_path or not Path(dataset.file_path).exists():
        xml = build_exception_xml("LayerNotDefined", "Raster file not found on disk")
        return Response(
            content=xml, media_type=WMS_XML, status_code=404, headers=WMS_CORS
        )

    # Parse bbox
    bbox_str = _get_param(params, "bbox", "")
    if not bbox_str:
        xml = build_exception_xml("MissingParameterValue", "BBOX parameter is required")
        return Response(
            content=xml, media_type=WMS_XML, status_code=400, headers=WMS_CORS
        )

    try:
        parts = [float(x) for x in bbox_str.split(",")]
        if len(parts) != 4:
            raise ValueError("Expected 4 values")
    except ValueError:
        xml = build_exception_xml("InvalidParameterValue", "Invalid BBOX format")
        return Response(
            content=xml, media_type=WMS_XML, status_code=400, headers=WMS_CORS
        )

    # WMS 1.3.0 with EPSG:4326: bbox is (miny, minx, maxy, maxx) — lat/lon order
    # WMS 1.1.1 and EPSG:3857: bbox is (minx, miny, maxx, maxy)
    crs = (
        _get_param(params, "crs") or _get_param(params, "srs") or "EPSG:4326"
    ).upper()
    if crs == "EPSG:4326":
        # WMS 1.3.0 axis order: lat,lon
        miny, minx, maxy, maxx = parts
    else:
        minx, miny, maxx, maxy = parts

    # For rendering, we always pass bbox in EPSG:4326 lon/lat order
    if crs == "EPSG:3857":
        from pyproj import Transformer

        t = Transformer.from_crs("EPSG:3857", "EPSG:4326", always_xy=True)
        minx, miny = t.transform(minx, miny)
        maxx, maxy = t.transform(maxx, maxy)

    bbox = (minx, miny, maxx, maxy)

    # Parse dimensions
    try:
        width = int(_get_param(params, "width", "256") or "256")
        height = int(_get_param(params, "height", "256") or "256")
    except ValueError:
        width, height = 256, 256

    width = min(max(width, 1), 4096)
    height = min(max(height, 1), 4096)

    # Format
    fmt_param = (_get_param(params, "format") or "image/png").lower()
    img_format = "JPEG" if "jpeg" in fmt_param or "jpg" in fmt_param else "PNG"
    media_type = "image/jpeg" if img_format == "JPEG" else "image/png"

    style_config = dataset.style_config or {}
    meta = dataset.service_metadata or {}
    band_count = meta.get("band_count", 1)

    image_data = await asyncio.to_thread(
        render_bbox,
        dataset.file_path,
        bbox,
        width,
        height,
        style_config,
        band_count,
        img_format,
    )

    if not image_data:
        # Return transparent PNG for empty areas
        return Response(status_code=204, headers=WMS_CORS)

    headers = {**WMS_CORS, "Cache-Control": "public, max-age=3600"}
    return Response(content=image_data, media_type=media_type, headers=headers)
