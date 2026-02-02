import asyncio
import json
import logging
import math
import re
import uuid
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import geopandas as gpd
import rasterio
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.config import settings
from app.database import AsyncSessionLocal

logger = logging.getLogger(__name__)


def _validate_table_name(table_name: str) -> bool:
    """Validate table name to prevent SQL injection."""
    # Only allow alphanumeric characters and underscores
    return bool(re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', table_name))


def _serialize_properties(row: Any) -> dict[str, Any]:
    """Serialize a GeoDataFrame row's properties to JSON-safe dict."""
    properties: dict[str, Any] = {}
    for k, v in row.drop("geometry").to_dict().items():
        if v is None:
            properties[k] = None
        elif isinstance(v, float) and math.isnan(v):
            properties[k] = None
        elif hasattr(v, "isoformat"):  # datetime, Timestamp, etc.
            properties[k] = v.isoformat()
        elif hasattr(v, "item"):  # numpy types
            properties[k] = v.item()
        else:
            properties[k] = v
    return properties


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
            properties = _serialize_properties(row)

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

    async def _insert_features_batched(
        self,
        db: AsyncSession,
        table_name: str,
        gdf: gpd.GeoDataFrame,
        job_id: uuid.UUID | None = None,
        batch_size: int = 500,
    ) -> None:
        """Insert features in multi-row batches for performance."""
        if not _validate_table_name(table_name):
            raise ValueError(f"Invalid table name: {table_name}")

        total = len(gdf)
        rows = list(gdf.iterrows())

        for batch_start in range(0, total, batch_size):
            batch_end = min(batch_start + batch_size, total)
            batch = rows[batch_start:batch_end]

            # Build multi-row INSERT
            value_clauses = []
            params: dict[str, Any] = {}
            for i, (_, row) in enumerate(batch):
                geom_wkt = row.geometry.wkt
                properties = _serialize_properties(row)
                params[f"g{i}"] = geom_wkt
                params[f"p{i}"] = json.dumps(properties)
                value_clauses.append(
                    f"(ST_GeomFromText(:g{i}, 4326), CAST(:p{i} AS jsonb))"
                )

            insert_sql = text(
                f'INSERT INTO "{table_name}" (geom, properties) VALUES '
                + ", ".join(value_clauses)
            )
            await db.execute(insert_sql, params)
            await db.commit()

            # Update job progress (5% to 95% range for insert phase)
            if job_id is not None:
                progress = 5 + int((batch_end / total) * 90)
                try:
                    from app.crud import dataset as dataset_crud

                    job = await dataset_crud.get_upload_job(db, job_id)
                    if job:
                        await dataset_crud.update_upload_job(
                            db, job, progress=progress
                        )
                except Exception:
                    pass  # Don't fail inserts over progress updates

    async def process_vector_background(
        self,
        file_path: Path,
        dataset_id: uuid.UUID,
        job_id: uuid.UUID,
    ) -> None:
        """Background vector processing with its own DB session."""
        async with AsyncSessionLocal() as db:
            try:
                from app.crud import dataset as dataset_crud

                # Mark job as processing
                job = await dataset_crud.get_upload_job(db, job_id)
                if job:
                    await dataset_crud.update_upload_job(
                        db, job, status="processing", progress=5
                    )

                # Read file in thread pool to avoid blocking event loop
                gdf = await asyncio.to_thread(gpd.read_file, str(file_path))

                if gdf.empty:
                    raise ValueError("File contains no features")

                # Reproject to WGS84 if needed
                if gdf.crs and gdf.crs.to_epsg() != 4326:
                    gdf = gdf.to_crs(epsg=4326)
                elif gdf.crs is None:
                    gdf = gdf.set_crs(epsg=4326)

                geom_types = gdf.geometry.geom_type.unique()
                geom_type = geom_types[0] if len(geom_types) == 1 else "Geometry"
                bounds = gdf.total_bounds.tolist()
                table_name = f"vector_data_{str(dataset_id).replace('-', '_')}"

                await self._create_vector_table(db, table_name)
                await self._insert_features_batched(
                    db, table_name, gdf, job_id=job_id
                )

                # Update dataset with results
                dataset = await dataset_crud.get_dataset(db, dataset_id)
                if dataset:
                    dataset.geometry_type = geom_type
                    dataset.feature_count = len(gdf)
                    dataset.table_name = table_name
                    await db.commit()

                # Mark job completed
                job = await dataset_crud.get_upload_job(db, job_id)
                if job:
                    await dataset_crud.update_upload_job(
                        db,
                        job,
                        status="completed",
                        progress=100,
                        completed_at=datetime.now(timezone.utc),
                    )

                logger.info(
                    "Background vector processing completed: dataset=%s features=%d",
                    dataset_id,
                    len(gdf),
                )

            except Exception as e:
                logger.exception(
                    "Background vector processing failed: dataset=%s error=%s",
                    dataset_id,
                    str(e),
                )
                # Use a fresh session to mark failure in case the current one is broken
                async with AsyncSessionLocal() as err_db:
                    try:
                        from app.crud import dataset as dataset_crud

                        job = await dataset_crud.get_upload_job(err_db, job_id)
                        if job:
                            await dataset_crud.update_upload_job(
                                err_db,
                                job,
                                status="failed",
                                error_message=str(e)[:1000],
                            )
                    except Exception:
                        logger.exception("Failed to mark upload job as failed")

            finally:
                # Clean up temp directory
                parent = file_path.parent
                shutil.rmtree(str(parent), ignore_errors=True)

    async def process_raster_background(
        self,
        file_path: Path,
        dataset_id: uuid.UUID,
        job_id: uuid.UUID,
    ) -> None:
        """Background raster processing with its own DB session."""
        async with AsyncSessionLocal() as db:
            try:
                from app.crud import dataset as dataset_crud

                job = await dataset_crud.get_upload_job(db, job_id)
                if job:
                    await dataset_crud.update_upload_job(
                        db, job, status="processing", progress=10
                    )

                result = await asyncio.to_thread(
                    self._process_raster_sync, file_path, dataset_id
                )

                # Update dataset
                dataset = await dataset_crud.get_dataset(db, dataset_id)
                if dataset:
                    dataset.file_path = result["file_path"]
                    await db.commit()

                job = await dataset_crud.get_upload_job(db, job_id)
                if job:
                    await dataset_crud.update_upload_job(
                        db,
                        job,
                        status="completed",
                        progress=100,
                        completed_at=datetime.now(timezone.utc),
                    )

                logger.info(
                    "Background raster processing completed: dataset=%s", dataset_id
                )

            except Exception as e:
                logger.exception(
                    "Background raster processing failed: dataset=%s error=%s",
                    dataset_id,
                    str(e),
                )
                async with AsyncSessionLocal() as err_db:
                    try:
                        from app.crud import dataset as dataset_crud

                        job = await dataset_crud.get_upload_job(err_db, job_id)
                        if job:
                            await dataset_crud.update_upload_job(
                                err_db,
                                job,
                                status="failed",
                                error_message=str(e)[:1000],
                            )
                    except Exception:
                        logger.exception("Failed to mark upload job as failed")

            finally:
                parent = file_path.parent
                shutil.rmtree(str(parent), ignore_errors=True)

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
