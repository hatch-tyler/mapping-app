import re
import uuid as uuid_mod
from datetime import datetime, timezone
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status, Query, Response, Request
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text, select, insert
import geopandas as gpd
import logging

logger = logging.getLogger(__name__)


def _get_public_cors_headers() -> dict[str, str]:
    """Return CORS headers for public GeoJSON endpoints."""
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Max-Age": "86400",
    }

from app.database import get_db
from app.schemas.dataset import (
    DatasetResponse,
    DatasetListResponse,
    DatasetUpdate,
    VisibilityUpdate,
    PublicStatusUpdate,
    FieldMetadata,
    FieldMetadataResponse,
    FeatureRow,
    FeatureQueryResponse,
    ColumnFilter,
    UniqueValuesResponse,
    FieldStatisticsResponse,
)
from app.crud import dataset as dataset_crud
from app.api.deps import get_current_user, get_current_admin_user, get_optional_current_user, check_dataset_access
from app.models.user import User
from app.models.dataset import Dataset


def _validate_table_name(table_name: str) -> bool:
    """Validate table name to prevent SQL injection."""
    return bool(re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', table_name))

router = APIRouter(prefix="/datasets", tags=["datasets"])


def _get_project_name(dataset) -> str | None:
    """Safely get project name without triggering lazy load."""
    from sqlalchemy import inspect as sa_inspect
    state = sa_inspect(dataset)
    if 'project' not in state.dict:
        return None
    proj = state.dict.get('project')
    return proj.name if proj else None


def _get_linked_project_ids(dataset) -> list:
    """Safely get linked project IDs without triggering lazy load."""
    from sqlalchemy import inspect as sa_inspect
    state = sa_inspect(dataset)
    if 'linked_projects' not in state.dict:
        return []
    projects = state.dict.get('linked_projects', [])
    return [p.id for p in projects] if projects else []


def _get_linked_project_names(dataset) -> list:
    """Safely get linked project names without triggering lazy load."""
    from sqlalchemy import inspect as sa_inspect
    state = sa_inspect(dataset)
    if 'linked_projects' not in state.dict:
        return []
    projects = state.dict.get('linked_projects', [])
    return [p.name for p in projects] if projects else []


def dataset_to_response(dataset) -> DatasetResponse:
    # Extract bounds from service_metadata (stored during upload/probe)
    bounds = None
    if dataset.service_metadata:
        bounds = dataset.service_metadata.get("total_bounds")

    return DatasetResponse(
        id=dataset.id,
        name=dataset.name,
        description=dataset.description,
        data_type=dataset.data_type,
        geometry_type=dataset.geometry_type,
        source_format=dataset.source_format,
        srid=dataset.srid,
        bounds=bounds,
        is_visible=dataset.is_visible,
        is_public=dataset.is_public,
        style_config=dataset.style_config,
        min_zoom=dataset.min_zoom,
        max_zoom=dataset.max_zoom,
        file_path=dataset.file_path,
        table_name=dataset.table_name,
        feature_count=dataset.feature_count,
        created_by_id=dataset.created_by_id,
        created_at=dataset.created_at,
        updated_at=dataset.updated_at,
        source_type=dataset.source_type,
        category=dataset.category,
        geographic_scope=dataset.geographic_scope,
        service_url=dataset.service_url,
        service_type=dataset.service_type,
        service_layer_id=dataset.service_layer_id,
        service_metadata=dataset.service_metadata,
        project_id=dataset.project_id,
        project_name=_get_project_name(dataset),
        linked_project_ids=_get_linked_project_ids(dataset),
        linked_project_names=_get_linked_project_names(dataset),
        is_privileged=dataset.is_privileged,
        file_hash=dataset.file_hash if hasattr(dataset, 'file_hash') else None,
        snapshot_source_id=dataset.snapshot_source_id if hasattr(dataset, 'snapshot_source_id') else None,
        snapshot_date=dataset.snapshot_date.isoformat() if hasattr(dataset, 'snapshot_date') and dataset.snapshot_date else None,
        tags=[tag.name for tag in dataset.tags] if dataset.tags else [],
    )


@router.get("/browse", response_model=DatasetListResponse)
async def browse_datasets(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: User | None = Depends(get_optional_current_user),
):
    """Browse datasets with optional authentication.

    - Anonymous users: see only public datasets (is_public=True)
    - Authenticated users: see all visible datasets (is_visible=True)
    """
    datasets, total = await dataset_crud.get_browsable_datasets(
        db,
        user_authenticated=current_user is not None,
        user_id=current_user.id if current_user else None,
        skip=skip,
        limit=limit,
    )
    return DatasetListResponse(
        datasets=[dataset_to_response(d) for d in datasets],
        total=total,
    )


@router.get("/", response_model=DatasetListResponse)
async def list_datasets(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    visible_only: bool = Query(False),
    search: str | None = Query(None),
    category: str | None = Query(None),
    source_type: str | None = Query(None),
    geographic_scope: str | None = Query(None),
    data_type: str | None = Query(None),
    tags: str | None = Query(None),
    project_id: UUID | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    datasets, total = await dataset_crud.get_datasets(
        db,
        skip=skip,
        limit=limit,
        visible_only=visible_only,
        search=search,
        category=category,
        source_type=source_type,
        geographic_scope=geographic_scope,
        data_type=data_type,
        tags=tags,
        project_id=project_id,
        user_id=current_user.id,
        is_admin=current_user.is_admin,
    )
    return DatasetListResponse(
        datasets=[dataset_to_response(d) for d in datasets],
        total=total,
    )


@router.post("/refresh-local-metadata")
async def refresh_local_metadata(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """Refresh metadata for all local datasets by introspecting PostGIS tables."""
    from sqlalchemy import select
    result = await db.execute(
        select(Dataset).where(
            Dataset.source_type == "local",
            Dataset.table_name.isnot(None),
            Dataset.service_metadata.is_(None),
        )
    )
    datasets = result.scalars().all()

    updated = 0
    for ds in datasets:
        try:
            # Get field info from PostGIS table
            fields_data = await dataset_crud.get_dataset_fields(db, ds)
            metadata = {
                "fields": fields_data,
                "field_count": len(fields_data),
            }
            if ds.feature_count:
                metadata["total_features"] = ds.feature_count
            if ds.geometry_type:
                metadata["geometry_types"] = [ds.geometry_type]
            # Compute bounds from PostGIS table
            try:
                bounds_result = await db.execute(
                    text(f'SELECT ST_XMin(ext), ST_YMin(ext), ST_XMax(ext), ST_YMax(ext) FROM (SELECT ST_Extent(geom) as ext FROM "{ds.table_name}") sub')
                )
                bounds_row = bounds_result.fetchone()
                if bounds_row and bounds_row[0] is not None:
                    metadata["total_bounds"] = [float(bounds_row[0]), float(bounds_row[1]), float(bounds_row[2]), float(bounds_row[3])]
            except Exception:
                pass
            ds.service_metadata = metadata
            updated += 1
        except Exception:
            pass

    await db.commit()
    return {"updated": updated, "total": len(datasets)}


@router.post("/{dataset_id}/link-project")
async def link_dataset_to_project(
    dataset_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """Link a dataset to a project (many-to-many)."""
    body = await request.json()
    project_id = body.get("project_id")
    if not project_id:
        raise HTTPException(400, "project_id is required")

    dataset = await dataset_crud.get_dataset(db, dataset_id)
    if not dataset:
        raise HTTPException(404, "Dataset not found")

    from app.models.dataset import dataset_projects
    from sqlalchemy import insert
    from uuid import UUID as PyUUID

    try:
        await db.execute(
            insert(dataset_projects).values(
                dataset_id=dataset_id,
                project_id=PyUUID(project_id),
            )
        )
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(400, "Dataset is already linked to this project")

    await db.refresh(dataset)
    return dataset_to_response(dataset)


@router.delete("/{dataset_id}/unlink-project")
async def unlink_dataset_from_project(
    dataset_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """Unlink a dataset from a project."""
    body = await request.json()
    project_id = body.get("project_id")
    if not project_id:
        raise HTTPException(400, "project_id is required")

    from app.models.dataset import dataset_projects
    from sqlalchemy import delete
    from uuid import UUID as PyUUID

    await db.execute(
        delete(dataset_projects).where(
            dataset_projects.c.dataset_id == dataset_id,
            dataset_projects.c.project_id == PyUUID(project_id),
        )
    )
    await db.commit()

    dataset = await dataset_crud.get_dataset(db, dataset_id)
    return dataset_to_response(dataset)


@router.post("/{dataset_id}/snapshot")
async def create_dataset_snapshot(
    dataset_id: UUID,
    project_id: UUID = Query(..., description="Project to link the snapshot to"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """Create a point-in-time snapshot of a dataset for a project."""
    from shapely.geometry import shape
    from shapely import wkt
    from shapely.ops import transform
    from app.services.file_processor import FileProcessor
    from app.models.dataset import dataset_projects
    from app.services.external_source import fetch_all_features

    source_dataset = await dataset_crud.get_dataset(db, dataset_id)
    if not source_dataset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Dataset not found",
        )

    table_name = f"snapshot_{str(uuid_mod.uuid4()).replace('-', '_')}"

    try:
        if source_dataset.table_name:
            # Local dataset: copy from PostGIS table
            query = text(
                f'SELECT ST_AsText(geom) as wkt, properties FROM "{source_dataset.table_name}"'
            )
            result = await db.execute(query)
            rows = result.fetchall()

            geometries = [wkt.loads(row.wkt) for row in rows if row.wkt]
            props = [row.properties or {} for row in rows if row.wkt]
            if not geometries:
                raise ValueError("No valid geometries found in source dataset")
            gdf = gpd.GeoDataFrame(props, geometry=geometries, crs="EPSG:4326")

        elif source_dataset.service_url:
            # External dataset: fetch all features
            geojson_data = await fetch_all_features(
                source_dataset.service_url,
                source_dataset.service_type,
                source_dataset.service_layer_id or "0",
                max_features=50000,
            )
            if not geojson_data.get("features"):
                raise ValueError("No features returned from the external service")

            rows_list = []
            geometries = []
            for feat in geojson_data["features"]:
                props = feat.get("properties", {}) or {}
                geom = feat.get("geometry")
                if geom:
                    geometries.append(shape(geom))
                    rows_list.append(props)

            if not geometries:
                raise ValueError("No valid geometries found in fetched features")
            gdf = gpd.GeoDataFrame(rows_list, geometry=geometries, crs="EPSG:4326")
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Dataset has no local data or external service URL to snapshot",
            )

        # Strip Z coordinates if present
        if gdf.geometry.has_z.any():
            gdf["geometry"] = gdf.geometry.apply(
                lambda geom: transform(lambda x, y, z=None: (x, y), geom)
                if geom and geom.has_z
                else geom
            )

        # Create PostGIS table and insert features
        processor = FileProcessor()
        await processor._create_vector_table(db, table_name)
        await processor._insert_features(db, table_name, gdf)

        # Determine geometry type
        geom_types = gdf.geometry.geom_type.unique()
        geom_type = geom_types[0] if len(geom_types) == 1 else "Geometry"

        snapshot = Dataset(
            id=uuid_mod.uuid4(),
            name=f"{source_dataset.name} (Snapshot)",
            description=f"Snapshot of '{source_dataset.name}' taken on {datetime.now(timezone.utc).strftime('%Y-%m-%d')}",
            data_type="vector",
            geometry_type=geom_type,
            source_format="snapshot",
            srid=4326,
            is_visible=True,
            table_name=table_name,
            feature_count=len(gdf),
            source_type="snapshot",
            category="project",
            project_id=project_id,
            snapshot_source_id=dataset_id,
            snapshot_date=datetime.now(timezone.utc),
            created_by_id=current_user.id,
            service_metadata={
                "original_name": source_dataset.name,
                "original_service_url": source_dataset.service_url,
                "original_service_type": source_dataset.service_type,
                "original_source_type": source_dataset.source_type,
                "snapshot_feature_count": len(gdf),
            },
        )
        db.add(snapshot)
        await db.flush()

        # Link snapshot to project via junction table
        await db.execute(
            insert(dataset_projects).values(
                dataset_id=snapshot.id,
                project_id=project_id,
            )
        )
        await db.commit()
        await db.refresh(snapshot)

        return dataset_to_response(snapshot)

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to create snapshot of dataset %s: %s", dataset_id, e)
        # Clean up partial table on failure
        try:
            await db.rollback()
            await db.execute(text(f'DROP TABLE IF EXISTS "{table_name}"'))
            await db.commit()
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create dataset snapshot: {str(e)}",
        )


@router.get("/{dataset_id}", response_model=DatasetResponse)
async def get_dataset(
    dataset_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    dataset = await dataset_crud.get_dataset(db, dataset_id)
    if not dataset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Dataset not found",
        )
    await check_dataset_access(dataset, current_user, db)
    return dataset_to_response(dataset)


@router.put("/{dataset_id}", response_model=DatasetResponse)
async def update_dataset(
    dataset_id: UUID,
    dataset_in: DatasetUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    dataset = await dataset_crud.get_dataset(db, dataset_id)
    if not dataset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Dataset not found",
        )

    updated = await dataset_crud.update_dataset(db, dataset, dataset_in)
    return dataset_to_response(updated)


@router.delete("/{dataset_id}")
async def delete_dataset(
    dataset_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    dataset = await dataset_crud.get_dataset(db, dataset_id)
    if not dataset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Dataset not found",
        )

    await dataset_crud.delete_dataset(db, dataset)
    return {"message": "Dataset deleted successfully"}


@router.get("/{dataset_id}/fields", response_model=FieldMetadataResponse)
async def get_dataset_fields(
    dataset_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = Depends(get_optional_current_user),
):
    """Get field metadata for a dataset.

    Access control: public datasets or authenticated user.
    """
    dataset = await dataset_crud.get_dataset(db, dataset_id)
    if not dataset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Dataset not found",
        )

    # Access control
    if not dataset.is_public and current_user is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Dataset is not public",
        )

    # Project membership check for non-public datasets
    if not dataset.is_public:
        await check_dataset_access(dataset, current_user, db)

    if dataset.data_type != "vector":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Field metadata only available for vector datasets",
        )

    fields_data = await dataset_crud.get_dataset_fields(db, dataset)
    fields = [FieldMetadata(name=f["name"], field_type=f["field_type"]) for f in fields_data]

    return FieldMetadataResponse(dataset_id=dataset_id, fields=fields)


@router.get("/{dataset_id}/features", response_model=FeatureQueryResponse)
async def query_features(
    dataset_id: UUID,
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=1000),
    sort_field: str | None = Query(None),
    sort_order: str = Query("asc", pattern="^(asc|desc)$"),
    filters: str | None = Query(None, description="JSON-encoded array of ColumnFilter objects"),
    db: AsyncSession = Depends(get_db),
    current_user: User | None = Depends(get_optional_current_user),
):
    """Query features from a dataset with pagination, sorting, and filtering.

    Access control: public datasets or authenticated user.
    Returns attributes without geometry for performance.
    """
    import json

    dataset = await dataset_crud.get_dataset(db, dataset_id)
    if not dataset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Dataset not found",
        )

    # Access control
    if not dataset.is_public and current_user is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Dataset is not public",
        )

    # Project membership check for non-public datasets
    if not dataset.is_public:
        await check_dataset_access(dataset, current_user, db)

    if dataset.data_type != "vector":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Feature query only available for vector datasets",
        )

    # Parse filters if provided
    parsed_filters = None
    if filters:
        try:
            filters_data = json.loads(filters)
            parsed_filters = [ColumnFilter(**f) for f in filters_data]
        except (json.JSONDecodeError, ValueError) as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid filter format",
            )

    features, total_count = await dataset_crud.query_features(
        db,
        dataset,
        page=page,
        page_size=page_size,
        sort_field=sort_field,
        sort_order=sort_order,
        filters=parsed_filters,
    )

    total_pages = (total_count + page_size - 1) // page_size if total_count > 0 else 1

    return FeatureQueryResponse(
        features=[FeatureRow(id=f["id"], properties=f["properties"]) for f in features],
        total_count=total_count,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.patch("/{dataset_id}/visibility", response_model=DatasetResponse)
async def toggle_visibility(
    dataset_id: UUID,
    visibility: VisibilityUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    dataset = await dataset_crud.get_dataset(db, dataset_id)
    if not dataset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Dataset not found",
        )

    updated = await dataset_crud.update_visibility(db, dataset, visibility.is_visible)
    return dataset_to_response(updated)


@router.patch("/{dataset_id}/public", response_model=DatasetResponse)
async def toggle_public_status(
    dataset_id: UUID,
    public_status: PublicStatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """Toggle the public sharing status of a dataset. Admin only."""
    dataset = await dataset_crud.get_dataset(db, dataset_id)
    if not dataset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Dataset not found",
        )

    updated = await dataset_crud.update_public_status(db, dataset, public_status.is_public)
    return dataset_to_response(updated)


@router.get("/{dataset_id}/geojson")
async def get_dataset_geojson(
    dataset_id: UUID,
    bbox: str | None = Query(None, description="minx,miny,maxx,maxy"),
    limit: int = Query(10000, le=50000),
    db: AsyncSession = Depends(get_db),
    current_user: User | None = Depends(get_optional_current_user),
):
    """Get GeoJSON data for a dataset. Public datasets available to all, others require authentication."""
    dataset = await dataset_crud.get_dataset(db, dataset_id)
    if not dataset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Dataset not found",
        )

    # Access control: public datasets available to all, others require authentication
    if not dataset.is_public and not current_user:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Authentication required for non-public datasets",
        )

    # Project membership check for non-public datasets
    if not dataset.is_public:
        await check_dataset_access(dataset, current_user, db)

    if dataset.data_type != "vector":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="GeoJSON endpoint only available for vector datasets",
        )

    if not dataset.table_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Dataset has no associated data table",
        )

    # Validate table name to prevent SQL injection
    table_name = dataset.table_name
    if not _validate_table_name(table_name):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Invalid table name in dataset",
        )

    # Build query with parameterized values
    params: dict = {"limit": limit}

    if bbox:
        try:
            minx, miny, maxx, maxy = map(float, bbox.split(","))
            params.update({"minx": minx, "miny": miny, "maxx": maxx, "maxy": maxy})
            query = f"""
                SELECT jsonb_build_object(
                    'type', 'FeatureCollection',
                    'features', COALESCE(jsonb_agg(
                        jsonb_build_object(
                            'type', 'Feature',
                            'id', sub.id,
                            'geometry', ST_AsGeoJSON(sub.geom)::jsonb,
                            'properties', sub.properties
                        )
                    ), '[]'::jsonb)
                ) as geojson
                FROM (
                    SELECT id, geom, properties
                    FROM "{table_name}"
                    WHERE ST_Intersects(geom, ST_MakeEnvelope(:minx, :miny, :maxx, :maxy, 4326))
                    LIMIT :limit
                ) sub
            """
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid bbox format. Expected: minx,miny,maxx,maxy",
            )
    else:
        query = f"""
            SELECT jsonb_build_object(
                'type', 'FeatureCollection',
                'features', COALESCE(jsonb_agg(
                    jsonb_build_object(
                        'type', 'Feature',
                        'id', sub.id,
                        'geometry', ST_AsGeoJSON(sub.geom)::jsonb,
                        'properties', sub.properties
                    )
                ), '[]'::jsonb)
            ) as geojson
            FROM (
                SELECT id, geom, properties
                FROM "{table_name}"
                LIMIT :limit
            ) sub
        """

    result = await db.execute(text(query), params)
    row = result.fetchone()

    geojson_data = row[0] if row and row[0] else {"type": "FeatureCollection", "features": []}

    # Return with CORS headers for public access (ArcGIS Pro, QGIS, etc.)
    headers = _get_public_cors_headers()
    headers["Cache-Control"] = "public, max-age=300"

    return JSONResponse(
        content=geojson_data,
        media_type="application/geo+json",
        headers=headers,
    )


@router.options("/{dataset_id}/geojson")
async def geojson_options(dataset_id: UUID):
    """Handle CORS preflight requests for GeoJSON endpoint."""
    return Response(
        status_code=204,
        headers=_get_public_cors_headers(),
    )


@router.head("/{dataset_id}/geojson")
async def geojson_head(
    dataset_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Handle HEAD requests for GeoJSON endpoint (used by GIS clients to validate)."""
    dataset = await dataset_crud.get_dataset(db, dataset_id)
    if not dataset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Dataset not found",
        )

    if not dataset.is_public:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Dataset is not public",
        )

    if dataset.data_type != "vector":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="GeoJSON endpoint only available for vector datasets",
        )

    headers = _get_public_cors_headers()
    headers["Content-Type"] = "application/geo+json"
    headers["Cache-Control"] = "public, max-age=300"

    return Response(
        status_code=200,
        headers=headers,
    )


@router.get("/{dataset_id}/fields/{field_name}/unique-values", response_model=UniqueValuesResponse)
async def get_unique_field_values(
    dataset_id: UUID,
    field_name: str,
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: User | None = Depends(get_optional_current_user),
):
    """Get unique values for a specific field in a dataset.

    Access control: public datasets or authenticated user.
    Useful for categorical styling to get all unique values for a field.
    """
    dataset = await dataset_crud.get_dataset(db, dataset_id)
    if not dataset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Dataset not found",
        )

    # Access control
    if not dataset.is_public and current_user is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Dataset is not public",
        )

    # Project membership check for non-public datasets
    if not dataset.is_public:
        await check_dataset_access(dataset, current_user, db)

    if dataset.data_type != "vector":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unique values only available for vector datasets",
        )

    values, total_count = await dataset_crud.get_unique_field_values(
        db, dataset, field_name, limit
    )

    return UniqueValuesResponse(
        field=field_name,
        values=values,
        total_count=total_count,
    )


@router.get("/{dataset_id}/fields/{field_name}/statistics", response_model=FieldStatisticsResponse)
async def get_field_statistics(
    dataset_id: UUID,
    field_name: str,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = Depends(get_optional_current_user),
):
    """Get statistics (min, max, mean) for a numeric field.

    Access control: public datasets or authenticated user.
    Useful for graduated styling to determine value ranges.
    """
    dataset = await dataset_crud.get_dataset(db, dataset_id)
    if not dataset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Dataset not found",
        )

    # Access control
    if not dataset.is_public and current_user is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Dataset is not public",
        )

    # Project membership check for non-public datasets
    if not dataset.is_public:
        await check_dataset_access(dataset, current_user, db)

    if dataset.data_type != "vector":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Statistics only available for vector datasets",
        )

    stats = await dataset_crud.get_field_statistics(db, dataset, field_name)

    return FieldStatisticsResponse(
        field=field_name,
        min=stats["min"],
        max=stats["max"],
        mean=stats["mean"],
        count=stats["count"],
    )
