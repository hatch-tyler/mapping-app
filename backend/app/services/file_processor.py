import asyncio
import json
import math
import re
import uuid
import shutil
from pathlib import Path
from typing import Any

import geopandas as gpd
import rasterio
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.config import settings


def _validate_table_name(table_name: str) -> bool:
    """Validate table name to prevent SQL injection."""
    # Only allow alphanumeric characters and underscores
    return bool(re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', table_name))


class FileProcessor:
    SUPPORTED_VECTOR = {".geojson", ".json", ".shp", ".gpkg", ".zip"}
    SUPPORTED_RASTER = {".tif", ".tiff", ".geotiff"}

    @staticmethod
    def get_file_extension(filename: str) -> str:
        return Path(filename).suffix.lower()

    @staticmethod
    def is_vector_file(filename: str) -> bool:
        ext = FileProcessor.get_file_extension(filename)
        return ext in FileProcessor.SUPPORTED_VECTOR

    @staticmethod
    def is_raster_file(filename: str) -> bool:
        ext = FileProcessor.get_file_extension(filename)
        return ext in FileProcessor.SUPPORTED_RASTER

    async def process_vector(
        self,
        file_path: Path,
        dataset_id: uuid.UUID,
        db: AsyncSession,
    ) -> dict[str, Any]:
        # Read file with geopandas
        gdf = gpd.read_file(str(file_path))

        if gdf.empty:
            raise ValueError("File contains no features")

        # Reproject to WGS84 if needed
        if gdf.crs and gdf.crs.to_epsg() != 4326:
            gdf = gdf.to_crs(epsg=4326)
        elif gdf.crs is None:
            # Assume WGS84 if no CRS
            gdf = gdf.set_crs(epsg=4326)

        # Get geometry type
        geom_types = gdf.geometry.geom_type.unique()
        geom_type = geom_types[0] if len(geom_types) == 1 else "Geometry"

        # Calculate bounds
        bounds = gdf.total_bounds.tolist()  # [minx, miny, maxx, maxy]

        # Create table name
        table_name = f"vector_data_{str(dataset_id).replace('-', '_')}"

        # Create table
        await self._create_vector_table(db, table_name)

        # Insert features
        await self._insert_features(db, table_name, gdf)

        return {
            "geometry_type": geom_type,
            "feature_count": len(gdf),
            "bounds": bounds,
            "table_name": table_name,
            "columns": [col for col in gdf.columns if col != "geometry"],
        }

    async def _create_vector_table(self, db: AsyncSession, table_name: str) -> None:
        # Validate table name to prevent SQL injection
        if not _validate_table_name(table_name):
            raise ValueError(f"Invalid table name: {table_name}")

        create_sql = f"""
            CREATE TABLE IF NOT EXISTS "{table_name}" (
                id SERIAL PRIMARY KEY,
                geom GEOMETRY(Geometry, 4326),
                properties JSONB,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        """
        await db.execute(text(create_sql))

        # Create spatial index
        index_sql = f"""
            CREATE INDEX IF NOT EXISTS "idx_{table_name}_geom"
            ON "{table_name}" USING GIST(geom)
        """
        await db.execute(text(index_sql))
        await db.commit()

    async def _insert_features(
        self, db: AsyncSession, table_name: str, gdf: gpd.GeoDataFrame
    ) -> None:
        # Validate table name
        if not _validate_table_name(table_name):
            raise ValueError(f"Invalid table name: {table_name}")

        for _, row in gdf.iterrows():
            geom_wkt = row.geometry.wkt
            # Properly handle NaN values, Timestamps, and other types for JSON
            properties = {}
            for k, v in row.drop("geometry").to_dict().items():
                if v is None:
                    properties[k] = None
                elif isinstance(v, float) and math.isnan(v):
                    properties[k] = None
                elif hasattr(v, 'isoformat'):  # datetime, Timestamp, etc.
                    properties[k] = v.isoformat()
                elif hasattr(v, 'item'):  # numpy types
                    properties[k] = v.item()
                else:
                    properties[k] = v

            # Use bindparam style for SQLAlchemy text() with asyncpg
            insert_sql = text(f"""
                INSERT INTO "{table_name}" (geom, properties)
                VALUES (ST_GeomFromText(:geom, 4326), CAST(:properties AS jsonb))
            """)
            await db.execute(
                insert_sql,
                {"geom": geom_wkt, "properties": json.dumps(properties)},
            )

        await db.commit()

    async def process_raster(
        self,
        file_path: Path,
        dataset_id: uuid.UUID,
    ) -> dict[str, Any]:
        # Run blocking I/O in a thread pool to avoid blocking the event loop
        return await asyncio.to_thread(
            self._process_raster_sync, file_path, dataset_id
        )

    def _process_raster_sync(
        self,
        file_path: Path,
        dataset_id: uuid.UUID,
    ) -> dict[str, Any]:
        """Synchronous raster processing (runs in thread pool)."""
        output_dir = Path(settings.RASTER_DIR)
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / f"{dataset_id}.tif"

        # For now, just copy the file (in production, convert to COG)
        # COG conversion requires GDAL which may not be available in all environments
        shutil.copy(str(file_path), str(output_path))

        # Get metadata
        with rasterio.open(output_path) as src:
            bounds = list(src.bounds)
            crs = str(src.crs) if src.crs else "EPSG:4326"
            width = src.width
            height = src.height

        return {
            "file_path": str(output_path),
            "bounds": [bounds[0], bounds[1], bounds[2], bounds[3]],
            "crs": crs,
            "width": width,
            "height": height,
        }


file_processor = FileProcessor()
