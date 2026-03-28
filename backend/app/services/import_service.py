"""Background import service for external vector datasets.

Uses short-lived DB sessions for each phase to avoid holding connections
during long network I/O operations.
"""

import logging
import uuid
from datetime import datetime, timezone

from app.database import AsyncSessionLocal
from app.services.external_source import fetch_all_features
from app.services.file_processor import FileProcessor

logger = logging.getLogger(__name__)


async def _update_job(job_id: uuid.UUID, **kwargs) -> None:
    """Update an upload job with a short-lived session."""
    async with AsyncSessionLocal() as db:
        from app.crud import dataset as dataset_crud

        job = await dataset_crud.get_upload_job(db, job_id)
        if job:
            await dataset_crud.update_upload_job(db, job, **kwargs)


async def import_external_background(
    dataset_id: uuid.UUID,
    job_id: uuid.UUID,
    service_url: str,
    service_type: str,
    service_layer_id: str,
    original_metadata: dict,
) -> None:
    """Background task: fetch features from external service and import to PostGIS.

    Each phase uses its own short-lived DB session so that the connection pool
    is not held during long network I/O operations. This keeps the app responsive
    for other users while the import runs.
    """
    table_name = f"vector_data_{str(dataset_id).replace('-', '_')}"

    try:
        # Phase 1: Mark job as processing (quick session)
        await _update_job(job_id, status="processing", progress=5)

        # Phase 2: Fetch features from external service (NO DB session held)
        logger.info(
            "Import %s: fetching features from %s/%s",
            dataset_id, service_url, service_layer_id,
        )
        geojson_data = await fetch_all_features(
            service_url,
            service_type,
            service_layer_id,
            max_features=50000,
            timeout=120.0,
        )

        features = geojson_data.get("features", [])
        if not features:
            raise ValueError("No features returned from the external service")

        logger.info("Import %s: fetched %d features", dataset_id, len(features))

        # Phase 3: Update progress after fetch (quick session)
        await _update_job(job_id, progress=45)

        # Phase 4: Convert to GeoDataFrame (NO DB session held)
        from shapely.geometry import shape
        import geopandas as gpd

        rows = []
        geometries = []
        for feat in features:
            props = feat.get("properties", {}) or {}
            geom = feat.get("geometry")
            if geom:
                geometries.append(shape(geom))
                rows.append(props)

        if not geometries:
            raise ValueError("No valid geometries found in fetched features")

        gdf = gpd.GeoDataFrame(rows, geometry=geometries, crs="EPSG:4326")

        # Strip Z coordinates if present
        if gdf.geometry.has_z.any():
            from shapely.ops import transform

            gdf["geometry"] = gdf.geometry.apply(
                lambda geom: transform(lambda x, y, z=None: (x, y), geom)
                if geom and geom.has_z
                else geom
            )

        await _update_job(job_id, progress=55)

        # Phase 5: Create table + insert features (session for DB work only)
        async with AsyncSessionLocal() as db:
            processor = FileProcessor()
            await processor._create_vector_table(db, table_name)
            await processor._insert_features_batched(db, table_name, gdf, job_id)

        # Phase 6: Update dataset record (quick session)
        async with AsyncSessionLocal() as db:
            from app.models.dataset import Dataset
            from sqlalchemy import select

            result = await db.execute(
                select(Dataset).where(Dataset.id == dataset_id)
            )
            dataset = result.scalar_one_or_none()
            if not dataset:
                raise ValueError(f"Dataset {dataset_id} not found after import")

            geom_types = gdf.geometry.geom_type.unique()
            geom_type = geom_types[0] if len(geom_types) == 1 else "Geometry"

            metadata = dict(original_metadata) if original_metadata else {}
            metadata["original_service_url"] = service_url
            metadata["original_service_type"] = service_type
            metadata["original_layer_id"] = service_layer_id
            metadata["imported_at"] = datetime.now(timezone.utc).isoformat()
            metadata["imported_feature_count"] = len(gdf)
            metadata["total_bounds"] = gdf.total_bounds.tolist()

            dataset.source_type = "local"
            dataset.table_name = table_name
            dataset.geometry_type = geom_type
            dataset.feature_count = len(gdf)
            dataset.data_type = "vector"
            dataset.service_metadata = metadata
            dataset.min_zoom = 0
            dataset.service_url = None
            dataset.service_type = None
            dataset.service_layer_id = None
            await db.commit()

        # Phase 7: Mark job completed (quick session)
        await _update_job(
            job_id,
            status="completed",
            progress=100,
            completed_at=datetime.now(timezone.utc),
        )

        logger.info(
            "Import %s: completed (%d features imported)",
            dataset_id, len(gdf),
        )

    except Exception as e:
        logger.exception("Import %s failed: %s", dataset_id, e)

        # Mark job as failed
        try:
            await _update_job(job_id, status="failed", error_message=str(e)[:500])
        except Exception:
            pass

        # Clean up partial table
        try:
            from sqlalchemy import text as sa_text

            async with AsyncSessionLocal() as db:
                await db.execute(sa_text(f'DROP TABLE IF EXISTS "{table_name}"'))
                await db.commit()
        except Exception:
            pass
