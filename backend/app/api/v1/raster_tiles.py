"""Raster tile serving endpoint using rio-tiler with colormap/rescaling support."""

import logging
from pathlib import Path
from uuid import UUID

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.crud import dataset as dataset_crud
from app.api.deps import get_optional_current_user, check_dataset_access
from app.models.user import User
from app.services.raster_colormap import (
    build_classified_colormap,
    build_continuous_colormap,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/raster", tags=["raster-tiles"])


def _get_tile_cors_headers() -> dict[str, str]:
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Max-Age": "86400",
    }


def _render_tile(
    file_path: str,
    z: int,
    x: int,
    y: int,
    style_config: dict | None = None,
    band_count: int = 1,
) -> bytes | None:
    """Render a raster tile using rio-tiler with optional colormap/rescaling."""
    from rio_tiler.io import Reader
    from rio_tiler.errors import TileOutsideBounds

    try:
        with Reader(file_path) as src:
            img = src.tile(x, y, z)

            # Multi-band RGB: render as-is
            if band_count >= 3:
                return img.render(img_format="PNG")

            sc = style_config or {}
            raster_mode = sc.get("raster_mode")

            if raster_mode == "classified":
                value_map = sc.get("value_map", {})
                if value_map:
                    cmap = build_classified_colormap(value_map)
                    return img.render(img_format="PNG", colormap=cmap)

            if raster_mode == "continuous":
                ramp_name = sc.get("color_ramp", "viridis")
                min_val = sc.get("min_value")
                max_val = sc.get("max_value")
                if min_val is not None and max_val is not None:
                    img.rescale(in_range=((float(min_val), float(max_val)),))
                else:
                    # Auto-stretch from tile data
                    data = img.data_as_image()[:, :, 0] if img.data.ndim == 3 else img.data
                    mask = img.mask > 0
                    if mask.any():
                        valid = data[mask]
                        vmin, vmax = float(valid.min()), float(valid.max())
                    else:
                        vmin, vmax = 0.0, 1.0
                    if vmax > vmin:
                        img.rescale(in_range=((vmin, vmax),))
                    else:
                        img.rescale(in_range=((vmin, vmin + 1),))
                cmap = build_continuous_colormap(ramp_name)
                return img.render(img_format="PNG", colormap=cmap)

            # Default: auto-stretch with viridis for single-band
            data = img.data_as_image()[:, :, 0] if img.data.ndim == 3 else img.data
            mask = img.mask > 0
            if mask.any():
                valid = data[mask]
                vmin, vmax = float(valid.min()), float(valid.max())
            else:
                vmin, vmax = 0.0, 1.0
            if vmax > vmin:
                img.rescale(in_range=((vmin, vmax),))
            else:
                img.rescale(in_range=((vmin, vmin + 1),))
            cmap = build_continuous_colormap("viridis")
            return img.render(img_format="PNG", colormap=cmap)

    except TileOutsideBounds:
        return None
    except Exception:
        logger.debug(
            "Tile render error for %s/%s/%s/%s", file_path, z, x, y, exc_info=True
        )
        return None


# --- Stats endpoint ---


class RasterBandStatistics(BaseModel):
    band: int
    min: float | None = None
    max: float | None = None
    mean: float | None = None
    std: float | None = None
    nodata_value: float | None = None
    dtype: str = ""
    unique_values: list[int] | None = None
    has_embedded_colormap: bool = False
    rat: dict | None = None


def _compute_raster_stats(file_path: str, band: int = 1) -> dict:
    """Compute raster band statistics (blocking I/O)."""
    import rasterio

    with rasterio.open(file_path) as src:
        if band < 1 or band > src.count:
            raise ValueError(f"Band {band} out of range (1-{src.count})")

        # Read decimated for speed on large rasters
        h = min(src.height, 2048)
        w = min(src.width, 2048)
        data = src.read(band, out_shape=(h, w)).astype(np.float64)

        nodata = src.nodata
        if nodata is not None:
            valid_mask = data != nodata
            valid = data[valid_mask]
        else:
            # Treat 0 as potential nodata for uint types, but still include in stats
            valid = data.ravel()

        result: dict = {
            "band": band,
            "dtype": str(src.dtypes[band - 1]),
            "nodata_value": float(nodata) if nodata is not None else None,
        }

        if valid.size > 0:
            result["min"] = float(valid.min())
            result["max"] = float(valid.max())
            result["mean"] = float(valid.mean())
            result["std"] = float(valid.std())
            unique = np.unique(valid)
            if len(unique) <= 256:
                result["unique_values"] = [int(v) for v in unique]
            else:
                result["unique_values"] = None
        else:
            result["min"] = None
            result["max"] = None
            result["mean"] = None
            result["std"] = None
            result["unique_values"] = None

        # Check for embedded colormap
        has_cmap = False
        try:
            cmap = src.colormap(band)
            has_cmap = bool(cmap)
        except ValueError:
            pass
        result["has_embedded_colormap"] = has_cmap

        return result


# --- Endpoints ---


@router.options("/{dataset_id}/tiles/{z}/{x}/{y}.png")
async def raster_tiles_options(dataset_id: UUID, z: int, x: int, y: int):
    return Response(status_code=204, headers=_get_tile_cors_headers())


@router.get("/{dataset_id}/tiles/{z}/{x}/{y}.png")
async def get_raster_tile(
    dataset_id: UUID,
    z: int,
    x: int,
    y: int,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = Depends(get_optional_current_user),
):
    """Serve raster tiles as PNG images with optional colormap/rescaling."""
    import asyncio

    if z < 0 or z > 22:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Zoom level must be between 0 and 22",
        )
    max_coord = (1 << z) - 1
    if x < 0 or x > max_coord or y < 0 or y > max_coord:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Tile coordinates out of range for zoom {z}",
        )

    dataset = await dataset_crud.get_dataset(db, dataset_id)
    if not dataset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Dataset not found",
        )

    # Public datasets open to all; non-public require auth, and project-scoped
    # datasets additionally require project membership.
    if not dataset.is_public:
        if not current_user:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Authentication required for non-public datasets",
            )
        await check_dataset_access(dataset, current_user, db)

    if dataset.data_type != "raster":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Raster tile endpoint only available for raster datasets",
        )

    if not dataset.file_path or not Path(dataset.file_path).exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Raster file not found on disk",
        )

    style_config = dataset.style_config or {}
    meta = dataset.service_metadata or {}
    band_count = meta.get("band_count", 1)

    tile_data = await asyncio.to_thread(
        _render_tile, dataset.file_path, z, x, y, style_config, band_count
    )

    headers = _get_tile_cors_headers()
    headers["Cache-Control"] = "public, max-age=86400"

    if not tile_data:
        return Response(status_code=204, headers=headers)

    return Response(
        content=tile_data,
        media_type="image/png",
        headers=headers,
    )


@router.get("/{dataset_id}/stats", response_model=RasterBandStatistics)
async def get_raster_stats(
    dataset_id: UUID,
    band: int = Query(1, ge=1),
    db: AsyncSession = Depends(get_db),
    current_user: User | None = Depends(get_optional_current_user),
):
    """Get statistics for a raster dataset band."""
    import asyncio

    dataset = await dataset_crud.get_dataset(db, dataset_id)
    if not dataset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Dataset not found",
        )

    # Public datasets open to all; non-public require auth, and project-scoped
    # datasets additionally require project membership.
    if not dataset.is_public:
        if not current_user:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Authentication required for non-public datasets",
            )
        await check_dataset_access(dataset, current_user, db)

    if dataset.data_type != "raster":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Stats endpoint only available for raster datasets",
        )

    if not dataset.file_path or not Path(dataset.file_path).exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Raster file not found on disk",
        )

    try:
        result = await asyncio.to_thread(
            _compute_raster_stats, dataset.file_path, band
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )

    # Include RAT from service_metadata if available
    meta = dataset.service_metadata or {}
    if meta.get("rat"):
        result["rat"] = meta["rat"]

    return result
