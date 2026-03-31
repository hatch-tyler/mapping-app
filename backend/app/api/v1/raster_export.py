"""Raster export endpoints for downloading raster datasets in various formats."""

import io
import logging
from pathlib import Path
from uuid import UUID

import numpy as np
import rasterio
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.crud import dataset as dataset_crud
from app.api.deps import get_optional_current_user, check_dataset_access
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/export", tags=["raster-export"])

RASTER_FORMATS = {
    "tif": {"media_type": "image/tiff", "ext": "tif", "label": "GeoTIFF"},
    "png": {"media_type": "image/png", "ext": "png", "label": "PNG"},
    "jpg": {"media_type": "image/jpeg", "ext": "jpg", "label": "JPEG"},
}


def _render_raster_to_image(file_path: str, fmt: str) -> bytes:
    """Render a raster file to PNG or JPEG (blocking I/O)."""
    from PIL import Image

    with rasterio.open(file_path) as src:
        # Read bands
        if src.count >= 3:
            # RGB or multi-band: use first 3 bands
            data = src.read([1, 2, 3])
        else:
            # Single band: render as grayscale or with colormap
            data = src.read(1)
            try:
                cmap = src.colormap(1)
            except ValueError:
                cmap = None

            if cmap:
                # Apply colormap: map pixel values to RGBA
                rgba = np.zeros((*data.shape, 4), dtype=np.uint8)
                for val, color in cmap.items():
                    mask = data == val
                    rgba[mask] = color[:4] if len(color) >= 4 else (*color, 255)
                img = Image.fromarray(rgba, "RGBA")
                buf = io.BytesIO()
                if fmt == "jpg":
                    img = img.convert("RGB")
                    img.save(buf, format="JPEG", quality=90)
                else:
                    img.save(buf, format="PNG")
                return buf.getvalue()

            # No colormap: normalize to 0-255
            data = data.astype(np.float64)
            nodata = src.nodata
            if nodata is not None:
                valid = data != nodata
                if valid.any():
                    vmin, vmax = data[valid].min(), data[valid].max()
                else:
                    vmin, vmax = 0, 1
            else:
                vmin, vmax = data.min(), data.max()

            if vmax > vmin:
                data = ((data - vmin) / (vmax - vmin) * 255).clip(0, 255)
            else:
                data = np.zeros_like(data)

            data = data.astype(np.uint8)
            img = Image.fromarray(data, "L")
            buf = io.BytesIO()
            if fmt == "jpg":
                img.save(buf, format="JPEG", quality=90)
            else:
                img.save(buf, format="PNG")
            return buf.getvalue()

        # Multi-band: normalize each band to 0-255
        result = np.zeros((data.shape[1], data.shape[2], 3), dtype=np.uint8)
        for i in range(3):
            band = data[i].astype(np.float64)
            bmin, bmax = band.min(), band.max()
            if bmax > bmin:
                band = ((band - bmin) / (bmax - bmin) * 255).clip(0, 255)
            result[:, :, i] = band.astype(np.uint8)

        img = Image.fromarray(result, "RGB")
        buf = io.BytesIO()
        if fmt == "jpg":
            img.save(buf, format="JPEG", quality=90)
        else:
            img.save(buf, format="PNG")
        return buf.getvalue()


@router.get("/{dataset_id}/raster/{fmt}")
async def export_raster(
    dataset_id: UUID,
    fmt: str,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = Depends(get_optional_current_user),
):
    """Download a raster dataset in the specified format."""
    import asyncio

    if fmt not in RASTER_FORMATS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported format: {fmt}. Supported: {', '.join(RASTER_FORMATS)}",
        )

    dataset = await dataset_crud.get_dataset(db, dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    await check_dataset_access(dataset, current_user, db)

    if dataset.data_type != "raster":
        raise HTTPException(status_code=400, detail="Not a raster dataset")

    if not dataset.file_path or not Path(dataset.file_path).exists():
        raise HTTPException(status_code=404, detail="Raster file not found on disk")

    format_info = RASTER_FORMATS[fmt]
    filename = f"{dataset.name}.{format_info['ext']}"

    if fmt == "tif":
        # Stream the GeoTIFF file directly
        file_path = Path(dataset.file_path)

        def iter_file():
            with open(file_path, "rb") as f:
                while chunk := f.read(1024 * 1024):
                    yield chunk

        return StreamingResponse(
            iter_file(),
            media_type=format_info["media_type"],
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    # Render to PNG or JPEG
    image_bytes = await asyncio.to_thread(
        _render_raster_to_image, dataset.file_path, fmt
    )

    return StreamingResponse(
        io.BytesIO(image_bytes),
        media_type=format_info["media_type"],
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
