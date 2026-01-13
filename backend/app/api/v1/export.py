"""Export endpoints for downloading datasets in various formats."""

import io
import os
import re
import tempfile
import zipfile
from uuid import UUID

import geopandas as gpd
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.crud.dataset import get_dataset

router = APIRouter(prefix="/export", tags=["export"])


async def get_geodataframe(db: AsyncSession, dataset_id: UUID) -> gpd.GeoDataFrame:
    """Fetch dataset from PostGIS and return as GeoDataFrame."""
    dataset = await get_dataset(db, dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    if dataset.data_type != "vector":
        raise HTTPException(status_code=400, detail="Export only available for vector datasets")

    if not dataset.table_name:
        raise HTTPException(status_code=400, detail="Dataset has no associated table")

    # Validate table name to prevent SQL injection
    if not re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', dataset.table_name):
        raise HTTPException(status_code=400, detail="Invalid table configuration")

    # Query data from PostGIS
    query = text(f"""
        SELECT
            id,
            ST_AsText(geom) as geometry,
            properties
        FROM "{dataset.table_name}"
    """)

    result = await db.execute(query)
    rows = result.fetchall()

    if not rows:
        raise HTTPException(status_code=404, detail="No features found in dataset")

    # Build GeoDataFrame
    from shapely import wkt

    features = []
    for row in rows:
        geom = wkt.loads(row[1]) if row[1] else None
        props = row[2] if row[2] else {}
        props['id'] = row[0]
        features.append({'geometry': geom, **props})

    gdf = gpd.GeoDataFrame(features, crs="EPSG:4326")

    return gdf, dataset.name


def sanitize_filename(name: str) -> str:
    """Sanitize filename for safe downloads."""
    # Remove or replace unsafe characters
    name = re.sub(r'[<>:"/\\|?*]', '_', name)
    name = re.sub(r'\s+', '_', name)
    return name[:100]  # Limit length


@router.get("/{dataset_id}/geojson")
async def export_geojson(
    dataset_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Export dataset as GeoJSON file."""
    gdf, name = await get_geodataframe(db, dataset_id)

    # Convert to GeoJSON
    geojson_str = gdf.to_json()

    filename = f"{sanitize_filename(name)}.geojson"

    return StreamingResponse(
        io.BytesIO(geojson_str.encode('utf-8')),
        media_type="application/geo+json",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Access-Control-Allow-Origin": "*",
        }
    )


@router.get("/{dataset_id}/gpkg")
async def export_geopackage(
    dataset_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Export dataset as GeoPackage file."""
    gdf, name = await get_geodataframe(db, dataset_id)

    # Write to temporary file
    with tempfile.NamedTemporaryFile(suffix='.gpkg', delete=False) as tmp:
        tmp_path = tmp.name

    try:
        gdf.to_file(tmp_path, driver='GPKG', layer=sanitize_filename(name))

        # Read the file
        with open(tmp_path, 'rb') as f:
            content = f.read()

        filename = f"{sanitize_filename(name)}.gpkg"

        return StreamingResponse(
            io.BytesIO(content),
            media_type="application/geopackage+sqlite3",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Access-Control-Allow-Origin": "*",
            }
        )
    finally:
        # Clean up temp file
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


@router.get("/{dataset_id}/shp")
async def export_shapefile(
    dataset_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Export dataset as Shapefile (zipped)."""
    gdf, name = await get_geodataframe(db, dataset_id)

    safe_name = sanitize_filename(name)

    # Create temporary directory for shapefile components
    with tempfile.TemporaryDirectory() as tmp_dir:
        shp_path = os.path.join(tmp_dir, f"{safe_name}.shp")

        # Shapefile has 10-char field name limit - truncate long names
        gdf_copy = gdf.copy()
        rename_map = {}
        for col in gdf_copy.columns:
            if col != 'geometry' and len(col) > 10:
                new_name = col[:10]
                # Handle duplicates
                counter = 1
                while new_name in rename_map.values():
                    new_name = col[:8] + str(counter)
                    counter += 1
                rename_map[col] = new_name

        if rename_map:
            gdf_copy = gdf_copy.rename(columns=rename_map)

        gdf_copy.to_file(shp_path, driver='ESRI Shapefile')

        # Create zip file in memory
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
            for ext in ['.shp', '.shx', '.dbf', '.prj', '.cpg']:
                filepath = os.path.join(tmp_dir, f"{safe_name}{ext}")
                if os.path.exists(filepath):
                    zf.write(filepath, f"{safe_name}{ext}")

        zip_buffer.seek(0)

        filename = f"{safe_name}.zip"

        return StreamingResponse(
            zip_buffer,
            media_type="application/zip",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Access-Control-Allow-Origin": "*",
            }
        )


@router.get("/{dataset_id}/kml")
async def export_kml(
    dataset_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Export dataset as KML file."""
    gdf, name = await get_geodataframe(db, dataset_id)

    # Write to temporary file (fiona/GDAL handles KML)
    with tempfile.NamedTemporaryFile(suffix='.kml', delete=False) as tmp:
        tmp_path = tmp.name

    try:
        # KML requires WGS84
        if gdf.crs and gdf.crs.to_epsg() != 4326:
            gdf = gdf.to_crs(epsg=4326)

        gdf.to_file(tmp_path, driver='KML')

        # Read the file
        with open(tmp_path, 'rb') as f:
            content = f.read()

        filename = f"{sanitize_filename(name)}.kml"

        return StreamingResponse(
            io.BytesIO(content),
            media_type="application/vnd.google-earth.kml+xml",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Access-Control-Allow-Origin": "*",
            }
        )
    finally:
        # Clean up temp file
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
