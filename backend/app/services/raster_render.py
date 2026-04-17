"""Shared raster rendering for WMS, ImageServer, and tile endpoints.

Renders a raster file to a PNG/JPEG image for a given bounding box and size,
applying style_config colormap/rescaling.
"""

import logging

from app.services.raster_colormap import build_classified_colormap, build_continuous_colormap

logger = logging.getLogger(__name__)


def render_bbox(
    file_path: str,
    bbox: tuple[float, float, float, float],
    width: int,
    height: int,
    style_config: dict | None = None,
    band_count: int = 1,
    img_format: str = "PNG",
) -> bytes | None:
    """Render a raster to an image for a given bbox and size.

    Args:
        file_path: Path to the raster file.
        bbox: (minx, miny, maxx, maxy) in the raster's CRS or EPSG:4326.
        width: Output image width in pixels.
        height: Output image height in pixels.
        style_config: Raster style config dict.
        band_count: Number of bands in the raster.
        img_format: "PNG" or "JPEG".

    Returns:
        Image bytes, or None if rendering fails.
    """
    from rio_tiler.io import Reader

    try:
        with Reader(file_path) as src:
            img = src.part(
                bbox,
                dst_crs="EPSG:4326",
                width=width,
                height=height,
            )

            # Multi-band RGB: render as-is
            if band_count >= 3:
                return img.render(img_format=img_format)

            sc = style_config or {}
            raster_mode = sc.get("raster_mode")

            if raster_mode == "classified":
                value_map = sc.get("value_map", {})
                if value_map:
                    cmap = build_classified_colormap(value_map)
                    return img.render(img_format=img_format, colormap=cmap)

            if raster_mode == "continuous":
                ramp_name = sc.get("color_ramp", "viridis")
                min_val = sc.get("min_value")
                max_val = sc.get("max_value")
                if min_val is not None and max_val is not None:
                    img.rescale(in_range=((float(min_val), float(max_val)),))
                else:
                    _auto_rescale(img)
                cmap = build_continuous_colormap(ramp_name)
                return img.render(img_format=img_format, colormap=cmap)

            # Default: auto-stretch with viridis
            _auto_rescale(img)
            cmap = build_continuous_colormap("viridis")
            return img.render(img_format=img_format, colormap=cmap)

    except Exception:
        logger.debug("Bbox render error for %s", file_path, exc_info=True)
        return None


def _auto_rescale(img) -> None:
    """Auto-rescale image data based on valid pixel range."""
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
