import re
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status, Query, Response
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text


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
)
from app.crud import dataset as dataset_crud
from app.api.deps import get_current_user, get_current_admin_user, get_optional_current_user
from app.models.user import User


def _validate_table_name(table_name: str) -> bool:
    """Validate table name to prevent SQL injection."""
    return bool(re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', table_name))

router = APIRouter(prefix="/datasets", tags=["datasets"])


def dataset_to_response(dataset) -> DatasetResponse:
    bounds = None
    if dataset.bounds is not None:
        # Extract bounds from geometry - simplified approach
        # In production, use ST_Extent or ST_Envelope
        bounds = None  # Will be set during upload

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
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    datasets, total = await dataset_crud.get_datasets(
        db, skip=skip, limit=limit, visible_only=visible_only
    )
    return DatasetListResponse(
        datasets=[dataset_to_response(d) for d in datasets],
        total=total,
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
                detail=f"Invalid filters format: {str(e)}",
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
                            'id', id,
                            'geometry', ST_AsGeoJSON(geom)::jsonb,
                            'properties', properties
                        )
                    ), '[]'::jsonb)
                ) as geojson
                FROM "{table_name}"
                WHERE ST_Intersects(geom, ST_MakeEnvelope(:minx, :miny, :maxx, :maxy, 4326))
                LIMIT :limit
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
                        'id', id,
                        'geometry', ST_AsGeoJSON(geom)::jsonb,
                        'properties', properties
                    )
                ), '[]'::jsonb)
            ) as geojson
            FROM "{table_name}"
            LIMIT :limit
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
