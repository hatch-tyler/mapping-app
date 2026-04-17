"""
ESRI ImageServer REST API endpoints for raster datasets.

Implements the ESRI REST API specification for image services.
Compatible with ArcGIS Pro, QGIS, and other GIS clients.
"""

import asyncio
import logging
import re
from pathlib import Path

from fastapi import APIRouter, Depends, Query, Response
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.dataset import Dataset
from app.services.raster_render import render_bbox

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/arcgis/rest/services", tags=["arcgis-image"])

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "*",
}


def _slugify(name: str) -> str:
    """Convert dataset name to URL-safe slug (matches query_handler.slugify)."""
    slug = re.sub(r"[^\w\s-]", "", name.lower())
    return re.sub(r"[-\s]+", "_", slug).strip("-_")


def _json(data: dict, status_code: int = 200) -> JSONResponse:
    headers = {**CORS_HEADERS, "Content-Type": "application/json; charset=utf-8"}
    return JSONResponse(content=data, status_code=status_code, headers=headers)


async def _find_raster_by_name(db: AsyncSession, service_name: str) -> Dataset | None:
    """Find a public raster dataset by name or slug."""
    # Exact name match
    result = await db.execute(
        select(Dataset).where(
            Dataset.name == service_name,
            Dataset.is_public == True,
            Dataset.data_type == "raster",
        )
    )
    dataset = result.scalar_one_or_none()
    if dataset:
        return dataset

    # Slug match
    result = await db.execute(
        select(Dataset).where(
            Dataset.is_public == True,
            Dataset.data_type == "raster",
            Dataset.file_path.isnot(None),
            func.lower(
                func.regexp_replace(
                    func.regexp_replace(Dataset.name, r"[^\w\s-]", "", "g"),
                    r"[-\s]+",
                    "_",
                    "g",
                )
            )
            == service_name.lower(),
        )
    )
    return result.scalar_one_or_none()


async def _get_public_raster_datasets(db: AsyncSession) -> list[Dataset]:
    result = await db.execute(
        select(Dataset)
        .where(
            Dataset.is_public == True,
            Dataset.data_type == "raster",
            Dataset.file_path.isnot(None),
        )
        .order_by(Dataset.name)
    )
    return list(result.scalars().all())


@router.get("/{service_name}/ImageServer")
async def get_image_server(
    service_name: str,
    f: str = Query("json"),
    db: AsyncSession = Depends(get_db),
):
    """Get ImageServer service metadata."""
    dataset = await _find_raster_by_name(db, service_name)
    if not dataset:
        return _json(
            {"error": {"code": 404, "message": f"Service '{service_name}' not found"}},
            status_code=404,
        )

    meta = dataset.service_metadata or {}
    total_bounds = meta.get("total_bounds", [-180, -90, 180, 90])
    minx, miny, maxx, maxy = (
        total_bounds if len(total_bounds) == 4 else [-180, -90, 180, 90]
    )

    response = {
        "currentVersion": 10.81,
        "serviceDescription": dataset.description or "",
        "name": dataset.name,
        "description": dataset.description or "",
        "extent": {
            "xmin": minx,
            "ymin": miny,
            "xmax": maxx,
            "ymax": maxy,
            "spatialReference": {"wkid": 4326, "latestWkid": 4326},
        },
        "initialExtent": {
            "xmin": minx,
            "ymin": miny,
            "xmax": maxx,
            "ymax": maxy,
            "spatialReference": {"wkid": 4326, "latestWkid": 4326},
        },
        "fullExtent": {
            "xmin": minx,
            "ymin": miny,
            "xmax": maxx,
            "ymax": maxy,
            "spatialReference": {"wkid": 4326, "latestWkid": 4326},
        },
        "pixelSizeX": 1,
        "pixelSizeY": 1,
        "bandCount": meta.get("band_count", 1),
        "pixelType": meta.get("dtypes", ["U8"])[0] if meta.get("dtypes") else "U8",
        "minPixelSize": 0,
        "maxPixelSize": 0,
        "copyrightText": "",
        "serviceDataType": "esriImageServiceDataTypeGeneric",
        "capabilities": "Image,Metadata",
        "supportedQueryFormats": "JSON",
        "exportTilesAllowed": False,
        "spatialReference": {"wkid": 4326, "latestWkid": 4326},
        "allowedMosaicMethods": "",
        "sortField": "",
        "sortValue": "",
    }

    if f == "html":
        return _json(response)
    return _json(response)


@router.get("/{service_name}/ImageServer/exportImage")
async def export_image(
    service_name: str,
    bbox: str = Query("", description="minx,miny,maxx,maxy"),
    size: str = Query("256,256", description="width,height"),
    format: str = Query("png"),
    f: str = Query("image", description="Response format: image or json"),
    bboxSR: str = Query("4326"),
    imageSR: str = Query("4326"),
    db: AsyncSession = Depends(get_db),
):
    """Export a raster image for a given bbox and size."""
    dataset = await _find_raster_by_name(db, service_name)
    if not dataset:
        return _json(
            {"error": {"code": 404, "message": f"Service '{service_name}' not found"}},
            status_code=404,
        )

    if not dataset.file_path or not Path(dataset.file_path).exists():
        return _json(
            {"error": {"code": 404, "message": "Raster file not found"}},
            status_code=404,
        )

    # Parse bbox
    if not bbox:
        meta = dataset.service_metadata or {}
        bounds = meta.get("total_bounds", [-180, -90, 180, 90])
        minx, miny, maxx, maxy = bounds
    else:
        try:
            parts = [float(x) for x in bbox.split(",")]
            if len(parts) != 4:
                raise ValueError()
            minx, miny, maxx, maxy = parts
        except ValueError:
            return _json(
                {"error": {"code": 400, "message": "Invalid bbox format"}},
                status_code=400,
            )

    # Convert from bboxSR to 4326 if needed
    if bboxSR and bboxSR != "4326":
        try:
            from pyproj import Transformer

            t = Transformer.from_crs(f"EPSG:{bboxSR}", "EPSG:4326", always_xy=True)
            minx, miny = t.transform(minx, miny)
            maxx, maxy = t.transform(maxx, maxy)
        except Exception:
            pass

    # Parse size
    try:
        w_str, h_str = size.split(",")
        width = min(max(int(w_str), 1), 4096)
        height = min(max(int(h_str), 1), 4096)
    except (ValueError, AttributeError):
        width, height = 256, 256

    img_format = "JPEG" if format.lower() in ("jpg", "jpeg") else "PNG"

    style_config = dataset.style_config or {}
    meta = dataset.service_metadata or {}
    band_count = meta.get("band_count", 1)

    image_data = await asyncio.to_thread(
        render_bbox,
        dataset.file_path,
        (minx, miny, maxx, maxy),
        width,
        height,
        style_config,
        band_count,
        img_format,
    )

    if f == "json":
        # Return image info as JSON (some clients request metadata only)
        return _json(
            {
                "href": "",
                "width": width,
                "height": height,
                "extent": {
                    "xmin": minx,
                    "ymin": miny,
                    "xmax": maxx,
                    "ymax": maxy,
                    "spatialReference": {"wkid": 4326},
                },
            }
        )

    if not image_data:
        return Response(status_code=204, headers=CORS_HEADERS)

    media_type = "image/jpeg" if img_format == "JPEG" else "image/png"
    headers = {**CORS_HEADERS, "Cache-Control": "public, max-age=3600"}
    return Response(content=image_data, media_type=media_type, headers=headers)
