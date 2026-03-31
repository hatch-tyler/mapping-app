"""Raster tile serving endpoint using rio-tiler."""

import logging
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.crud import dataset as dataset_crud
from app.api.deps import get_optional_current_user
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/raster", tags=["raster-tiles"])


def _get_tile_cors_headers() -> dict[str, str]:
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Max-Age": "86400",
    }


def _render_tile(file_path: str, z: int, x: int, y: int) -> bytes | None:
    """Render a raster tile using rio-tiler (blocking I/O, call from thread)."""
    from rio_tiler.io import Reader
    from rio_tiler.errors import TileOutsideBounds

    try:
        with Reader(file_path) as src:
            img = src.tile(x, y, z)
            return img.render(img_format="PNG")
    except TileOutsideBounds:
        return None
    except Exception:
        logger.debug("Tile render error for %s/%s/%s/%s", file_path, z, x, y, exc_info=True)
        return None


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
    """Serve raster tiles as PNG images."""
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

    if not dataset.is_public and not current_user:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Authentication required for non-public datasets",
        )

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

    # Render tile in thread pool (rio-tiler uses blocking I/O)
    tile_data = await asyncio.to_thread(
        _render_tile, dataset.file_path, z, x, y
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
