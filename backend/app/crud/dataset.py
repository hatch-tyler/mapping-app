import logging
from datetime import datetime
from uuid import UUID
from typing import Any

logger = logging.getLogger(__name__)
from sqlalchemy import select, func, text, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.dataset import Dataset, UploadJob
from app.models.tag import Tag, dataset_tags
from app.models.project import ProjectMember
from app.schemas.dataset import (
    DatasetCreate,
    DatasetUpdate,
    ColumnFilter,
    FilterOperator,
)


from app.utils.sql_validation import (
    validate_table_name as _validate_table_name,
    validate_field_name as _validate_field_name,
    escape_field_name as _escape_field_name,
)


async def get_dataset(db: AsyncSession, dataset_id: UUID) -> Dataset | None:
    result = await db.execute(select(Dataset).where(Dataset.id == dataset_id))
    return result.scalar_one_or_none()


async def get_datasets(
    db: AsyncSession,
    skip: int = 0,
    limit: int = 100,
    visible_only: bool = False,
    search: str | None = None,
    category: str | None = None,
    source_type: str | None = None,
    geographic_scope: str | None = None,
    data_type: str | None = None,
    tags: str | None = None,
    project_id: UUID | None = None,
    user_id: UUID | None = None,
    is_admin: bool = True,
) -> tuple[list[Dataset], int]:
    query = select(Dataset)
    count_query = select(func.count(Dataset.id.distinct()))

    if visible_only:
        query = query.where(Dataset.is_visible == True)
        count_query = count_query.where(Dataset.is_visible == True)

    if category:
        query = query.where(Dataset.category == category)
        count_query = count_query.where(Dataset.category == category)

    if source_type:
        query = query.where(Dataset.source_type == source_type)
        count_query = count_query.where(Dataset.source_type == source_type)

    if geographic_scope:
        query = query.where(Dataset.geographic_scope == geographic_scope)
        count_query = count_query.where(Dataset.geographic_scope == geographic_scope)

    if data_type:
        query = query.where(Dataset.data_type == data_type)
        count_query = count_query.where(Dataset.data_type == data_type)

    if project_id:
        query = query.where(Dataset.project_id == project_id)
        count_query = count_query.where(Dataset.project_id == project_id)

    if search:
        search_term = f"%{search}%"
        search_filter = or_(
            Dataset.name.ilike(search_term),
            Dataset.description.ilike(search_term),
        )
        # Also search tags via join
        tag_subquery = (
            select(dataset_tags.c.dataset_id)
            .join(Tag, Tag.id == dataset_tags.c.tag_id)
            .where(Tag.name.ilike(search_term))
        )
        search_filter = or_(search_filter, Dataset.id.in_(tag_subquery))
        query = query.where(search_filter)
        count_query = count_query.where(search_filter)

    if tags:
        tag_names = [t.strip() for t in tags.split(",") if t.strip()]
        if tag_names:
            tag_subquery = (
                select(dataset_tags.c.dataset_id)
                .join(Tag, Tag.id == dataset_tags.c.tag_id)
                .where(Tag.name.in_(tag_names))
            )
            query = query.where(Dataset.id.in_(tag_subquery))
            count_query = count_query.where(Dataset.id.in_(tag_subquery))

    # Non-admin users can only see project datasets they belong to
    if not is_admin and user_id:
        user_project_ids = select(ProjectMember.project_id).where(
            ProjectMember.user_id == user_id
        )
        access_filter = or_(
            Dataset.project_id.is_(None),
            Dataset.project_id.in_(user_project_ids),
        )
        query = query.where(access_filter)
        count_query = count_query.where(access_filter)

    query = query.order_by(Dataset.created_at.desc()).offset(skip).limit(limit)

    result = await db.execute(query)
    datasets = list(result.scalars().unique().all())

    count_result = await db.execute(count_query)
    total = count_result.scalar()

    return datasets, total


async def get_or_create_tags(db: AsyncSession, tag_names: list[str]) -> list[Tag]:
    """Get existing tags or create new ones. Returns list of Tag objects."""
    if not tag_names:
        return []

    tags = []
    for name in tag_names:
        name = name.strip().lower()
        if not name:
            continue
        result = await db.execute(select(Tag).where(Tag.name == name))
        tag = result.scalar_one_or_none()
        if not tag:
            tag = Tag(name=name)
            db.add(tag)
            await db.flush()
        tags.append(tag)
    return tags


async def create_dataset(
    db: AsyncSession,
    dataset_in: DatasetCreate,
    data_type: str,
    source_format: str,
    created_by_id: UUID | None = None,
    **kwargs,
) -> Dataset:
    dataset = Dataset(
        name=dataset_in.name,
        description=dataset_in.description,
        data_type=data_type,
        source_format=source_format,
        style_config=dataset_in.style_config,
        min_zoom=dataset_in.min_zoom,
        max_zoom=dataset_in.max_zoom,
        category=dataset_in.category,
        geographic_scope=dataset_in.geographic_scope,
        created_by_id=created_by_id,
        **kwargs,
    )

    if dataset_in.tags:
        dataset.tags = await get_or_create_tags(db, dataset_in.tags)

    db.add(dataset)
    await db.commit()
    await db.refresh(dataset)
    return dataset


async def update_dataset(
    db: AsyncSession, dataset: Dataset, dataset_in: DatasetUpdate
) -> Dataset:
    update_data = dataset_in.model_dump(exclude_unset=True)

    # Geographic scope is only valid for reference category
    if update_data.get("category") == "project":
        update_data["geographic_scope"] = None

    # Handle tags separately
    tag_names = update_data.pop("tags", None)
    if tag_names is not None:
        dataset.tags = await get_or_create_tags(db, tag_names)

    for field, value in update_data.items():
        setattr(dataset, field, value)

    await db.commit()
    await db.refresh(dataset)
    return dataset


async def delete_dataset(db: AsyncSession, dataset: Dataset) -> None:
    # If vector dataset, drop the data table
    if dataset.table_name:
        dialect = db.bind.dialect.name if db.bind else "postgresql"
        cascade = " CASCADE" if dialect != "sqlite" else ""
        await db.execute(text(f'DROP TABLE IF EXISTS "{dataset.table_name}"{cascade}'))

    await db.delete(dataset)
    await db.commit()


async def update_visibility(
    db: AsyncSession, dataset: Dataset, is_visible: bool
) -> Dataset:
    dataset.is_visible = is_visible
    await db.commit()
    await db.refresh(dataset)
    return dataset


async def update_public_status(
    db: AsyncSession, dataset: Dataset, is_public: bool
) -> Dataset:
    dataset.is_public = is_public
    await db.commit()
    await db.refresh(dataset)
    return dataset


async def create_upload_job(db: AsyncSession, dataset_id: UUID) -> UploadJob:
    job = UploadJob(dataset_id=dataset_id)
    db.add(job)
    await db.commit()
    await db.refresh(job)
    return job


async def get_upload_job(db: AsyncSession, job_id: UUID) -> UploadJob | None:
    result = await db.execute(select(UploadJob).where(UploadJob.id == job_id))
    return result.scalar_one_or_none()


async def update_upload_job(
    db: AsyncSession,
    job: UploadJob,
    status: str | None = None,
    progress: int | None = None,
    error_message: str | None = None,
    completed_at: datetime | None = None,
) -> UploadJob:
    if status is not None:
        job.status = status
    if progress is not None:
        job.progress = progress
    if error_message is not None:
        job.error_message = error_message
    if completed_at is not None:
        job.completed_at = completed_at

    await db.commit()
    await db.refresh(job)
    return job


async def get_stale_processing_jobs(db: AsyncSession) -> list[UploadJob]:
    """Return jobs stuck in 'pending' or 'processing' status (orphaned on restart)."""
    result = await db.execute(
        select(UploadJob).where(
            or_(UploadJob.status == "pending", UploadJob.status == "processing")
        )
    )
    return list(result.scalars().all())


async def get_browsable_datasets(
    db: AsyncSession,
    user_authenticated: bool,
    user_id: UUID | None = None,
    skip: int = 0,
    limit: int = 100,
) -> tuple[list[Dataset], int]:
    """Get datasets that are browsable based on authentication status.

    - Anonymous users: only public datasets (is_public=True), no project data
    - Authenticated users: visible reference data + project data they have access to
    """
    query = select(Dataset).options(selectinload(Dataset.project))
    count_query = select(func.count(Dataset.id))

    if user_authenticated and user_id:
        # Authenticated: visible reference data OR project data where user is a member
        from app.models.dataset import dataset_projects

        user_project_ids = select(ProjectMember.project_id).where(
            ProjectMember.user_id == user_id
        )
        linked_to_user_projects = select(dataset_projects.c.dataset_id).where(
            dataset_projects.c.project_id.in_(user_project_ids)
        )
        visibility_filter = or_(
            # Reference data (or uncategorized) that is visible
            Dataset.project_id.is_(None),
            # Project data where user is a member
            Dataset.project_id.in_(user_project_ids),
            # Datasets linked to user's projects via junction table
            Dataset.id.in_(linked_to_user_projects),
        )
        query = query.where(Dataset.is_visible == True).where(visibility_filter)
        count_query = count_query.where(Dataset.is_visible == True).where(
            visibility_filter
        )
    else:
        # Anonymous users only see public datasets, never project data
        query = query.where(Dataset.is_public == True).where(
            Dataset.project_id.is_(None)
        )
        count_query = count_query.where(Dataset.is_public == True).where(
            Dataset.project_id.is_(None)
        )

    query = query.order_by(Dataset.created_at.desc()).offset(skip).limit(limit)

    result = await db.execute(query)
    datasets = list(result.scalars().unique().all())

    count_result = await db.execute(count_query)
    total = count_result.scalar()

    return datasets, total


async def get_external_dataset_fields(dataset) -> list[dict]:
    """Get field metadata from an external vector dataset by fetching a sample feature."""
    from app.services.external_source import proxy_request

    if dataset.service_type not in ("arcgis_feature", "wfs"):
        return []

    # Check cached fields in service_metadata
    if dataset.service_metadata and dataset.service_metadata.get("fields"):
        return dataset.service_metadata["fields"]

    # Fetch a single feature to introspect field names/types
    try:
        if dataset.service_type == "arcgis_feature":
            url = f"{dataset.service_url.rstrip('/')}/{dataset.service_layer_id or '0'}/query"
            params = {
                "f": "json",
                "where": "1=1",
                "outFields": "*",
                "resultRecordCount": "1",
                "returnGeometry": "false",
            }
        else:  # wfs
            params = {
                "service": "WFS",
                "request": "GetFeature",
                "typeName": dataset.service_layer_id or "",
                "outputFormat": "application/json",
                "maxFeatures": "1",
                "srsName": "EPSG:4326",
            }
            url = dataset.service_url

        resp = await proxy_request(url, dataset.service_type, params)
        data = resp.json()

        # ArcGIS returns fields in metadata
        if dataset.service_type == "arcgis_feature" and "fields" in data:
            fields = []
            for f in data["fields"]:
                field_type = "string"
                esri_type = f.get("type", "")
                if "Integer" in esri_type or "SmallInteger" in esri_type:
                    field_type = "integer"
                elif "Double" in esri_type or "Single" in esri_type:
                    field_type = "float"
                elif "Date" in esri_type:
                    field_type = "date"
                fields.append({"name": f.get("name", ""), "field_type": field_type})
            return fields

        # Fallback: introspect from features
        features = data.get("features", [])
        if not features:
            return []

        props = features[0].get("properties") or features[0].get("attributes", {})
        fields = []
        for key, val in props.items():
            if isinstance(val, int):
                field_type = "integer"
            elif isinstance(val, float):
                field_type = "float"
            elif isinstance(val, bool):
                field_type = "boolean"
            else:
                field_type = "string"
            fields.append({"name": key, "field_type": field_type})
        return fields
    except Exception:
        logger.warning(
            "Failed to fetch fields for external dataset %s (%s)",
            dataset.id,
            dataset.service_url,
            exc_info=True,
        )
        return []


async def query_external_features(
    dataset,
    page: int = 1,
    page_size: int = 100,
) -> tuple[list[dict], int]:
    """Query features from an external vector dataset via proxy."""
    from app.services.external_source import proxy_request

    if dataset.service_type not in ("arcgis_feature", "wfs"):
        return [], 0

    offset = (page - 1) * page_size

    try:
        if dataset.service_type == "arcgis_feature":
            layer_id = dataset.service_layer_id or "0"
            base_url = f"{dataset.service_url.rstrip('/')}/{layer_id}/query"

            # First get total count
            count_params = {
                "f": "json",
                "where": "1=1",
                "returnCountOnly": "true",
            }
            count_resp = await proxy_request(
                base_url, dataset.service_type, count_params
            )
            count_data = count_resp.json()
            total = count_data.get("count", 0)

            # Then fetch the page
            params = {
                "f": "geojson",
                "where": "1=1",
                "outFields": "*",
                "outSR": "4326",
                "resultRecordCount": str(page_size),
                "resultOffset": str(offset),
            }
            resp = await proxy_request(base_url, dataset.service_type, params)
            data = resp.json()

        else:  # wfs
            # WFS doesn't have a standard count endpoint, estimate from first fetch
            params = {
                "service": "WFS",
                "request": "GetFeature",
                "typeName": dataset.service_layer_id or "",
                "outputFormat": "application/json",
                "srsName": "EPSG:4326",
                "maxFeatures": str(page_size),
                "startIndex": str(offset),
            }
            resp = await proxy_request(
                dataset.service_url, dataset.service_type, params
            )
            data = resp.json()
            # WFS may return totalFeatures or numberMatched
            total = data.get("totalFeatures") or data.get("numberMatched") or 0

        features = data.get("features", [])
        rows = []
        for i, feat in enumerate(features):
            props = feat.get("properties") or feat.get("attributes", {})
            geom = feat.get("geometry")
            row = {
                "id": offset + i + 1,
                "properties": props,
                "geometry": geom,
            }
            rows.append(row)

        return rows, total

    except Exception:
        return [], 0


async def get_dataset_fields(
    db: AsyncSession,
    dataset: Dataset,
) -> list[dict[str, str]]:
    """Introspect JSONB properties to get field names and types."""
    if dataset.source_type == "external":
        return await get_external_dataset_fields(dataset)

    if not dataset.table_name or not _validate_table_name(dataset.table_name):
        return []

    # Sample some rows to infer field types from properties JSONB
    query = text(f"""
        SELECT DISTINCT jsonb_object_keys(properties) as field_name
        FROM "{dataset.table_name}"
        WHERE properties IS NOT NULL
        LIMIT 100
    """)

    result = await db.execute(query)
    field_names = [row[0] for row in result.fetchall()]

    # For each field, try to infer its type from sample values
    fields = []
    for field_name in sorted(field_names):
        if not _validate_field_name(field_name):
            continue

        # Get sample values to infer type
        type_query = text(f"""
            SELECT DISTINCT jsonb_typeof(properties->:field_name) as field_type
            FROM "{dataset.table_name}"
            WHERE properties->:field_name IS NOT NULL
            LIMIT 5
        """)

        type_result = await db.execute(type_query, {"field_name": field_name})
        types = [row[0] for row in type_result.fetchall()]

        # Determine primary type
        if "number" in types:
            field_type = "number"
        elif "boolean" in types:
            field_type = "boolean"
        elif "string" in types:
            field_type = "string"
        else:
            field_type = "string"  # Default to string

        fields.append({"name": field_name, "field_type": field_type})

    return fields


async def query_features(
    db: AsyncSession,
    dataset: Dataset,
    page: int = 1,
    page_size: int = 100,
    sort_field: str | None = None,
    sort_order: str = "asc",
    filters: list[ColumnFilter] | None = None,
) -> tuple[list[dict[str, Any]], int]:
    """Query features from a dataset with pagination, sorting, and filtering.

    Returns features without geometry for performance.
    """
    if dataset.source_type == "external":
        return await query_external_features(dataset, page=page, page_size=page_size)

    if not dataset.table_name or not _validate_table_name(dataset.table_name):
        return [], 0

    # Build WHERE clause from filters
    where_clauses = []
    params: dict[str, Any] = {}

    if filters:
        for i, f in enumerate(filters):
            if not _validate_field_name(f.field):
                continue

            param_name = f"filter_val_{i}"
            field_accessor = f"(properties->>'{_escape_field_name(f.field)}')"

            if f.operator == FilterOperator.eq:
                where_clauses.append(f"{field_accessor} = :{param_name}")
                params[param_name] = str(f.value)
            elif f.operator == FilterOperator.ne:
                where_clauses.append(f"{field_accessor} != :{param_name}")
                params[param_name] = str(f.value)
            elif f.operator == FilterOperator.gt:
                where_clauses.append(f"({field_accessor})::numeric > :{param_name}")
                params[param_name] = float(f.value)
            elif f.operator == FilterOperator.gte:
                where_clauses.append(f"({field_accessor})::numeric >= :{param_name}")
                params[param_name] = float(f.value)
            elif f.operator == FilterOperator.lt:
                where_clauses.append(f"({field_accessor})::numeric < :{param_name}")
                params[param_name] = float(f.value)
            elif f.operator == FilterOperator.lte:
                where_clauses.append(f"({field_accessor})::numeric <= :{param_name}")
                params[param_name] = float(f.value)
            elif f.operator == FilterOperator.contains:
                where_clauses.append(
                    f"LOWER({field_accessor}) LIKE LOWER(:{param_name})"
                )
                params[param_name] = f"%{f.value}%"
            elif f.operator == FilterOperator.startswith:
                where_clauses.append(
                    f"LOWER({field_accessor}) LIKE LOWER(:{param_name})"
                )
                params[param_name] = f"{f.value}%"

    where_sql = " AND ".join(where_clauses) if where_clauses else "1=1"

    # Count total matching rows
    count_query = text(f"""
        SELECT COUNT(*) FROM "{dataset.table_name}"
        WHERE {where_sql}
    """)
    count_result = await db.execute(count_query, params)
    total_count = count_result.scalar() or 0

    # Build ORDER BY clause (whitelist sort direction to prevent injection)
    safe_order = "ASC" if sort_order.upper() != "DESC" else "DESC"
    order_sql = "id ASC"
    if sort_field:
        if sort_field == "id":
            order_sql = f"id {safe_order}"
        elif _validate_field_name(sort_field):
            order_sql = f"properties->>'{_escape_field_name(sort_field)}' {safe_order}"

    # Calculate offset
    offset = (page - 1) * page_size

    # Query features (without geometry)
    query = text(f"""
        SELECT id, properties
        FROM "{dataset.table_name}"
        WHERE {where_sql}
        ORDER BY {order_sql}
        LIMIT :page_size OFFSET :offset
    """)

    params["page_size"] = page_size
    params["offset"] = offset

    result = await db.execute(query, params)
    rows = result.fetchall()

    features = [{"id": row[0], "properties": row[1] or {}} for row in rows]

    return features, total_count


async def get_features_by_ids(
    db: AsyncSession,
    dataset: Dataset,
    feature_ids: list[int],
    include_geometry: bool = False,
) -> list[dict[str, Any]]:
    """Get features by their IDs."""
    if not dataset.table_name or not _validate_table_name(dataset.table_name):
        return []

    if not feature_ids:
        return []

    # Use parameterized query with ANY() to prevent SQL injection
    safe_ids = [int(fid) for fid in feature_ids]

    if include_geometry:
        query = text(f"""
            SELECT id, properties, ST_AsGeoJSON(geom)::jsonb as geometry
            FROM "{dataset.table_name}"
            WHERE id = ANY(:ids)
        """)
    else:
        query = text(f"""
            SELECT id, properties
            FROM "{dataset.table_name}"
            WHERE id = ANY(:ids)
        """)

    result = await db.execute(query, {"ids": safe_ids})
    rows = result.fetchall()

    if include_geometry:
        return [
            {"id": row[0], "properties": row[1] or {}, "geometry": row[2]}
            for row in rows
        ]
    else:
        return [{"id": row[0], "properties": row[1] or {}} for row in rows]


async def get_unique_field_values(
    db: AsyncSession,
    dataset: Dataset,
    field_name: str,
    limit: int = 100,
) -> tuple[list[Any], int]:
    """Get unique values for a specific field in a dataset."""
    if not _validate_field_name(field_name):
        return [], 0

    # External datasets: proxy to remote service
    if dataset.source_type == "external" and not dataset.table_name:
        return await _get_external_unique_values(dataset, field_name, limit)

    # Local datasets: query PostGIS
    if not dataset.table_name or not _validate_table_name(dataset.table_name):
        return [], 0

    # Count total unique values
    count_query = text(f"""
        SELECT COUNT(DISTINCT properties->>:field_name)
        FROM "{dataset.table_name}"
        WHERE properties->>:field_name IS NOT NULL
    """)
    count_result = await db.execute(count_query, {"field_name": field_name})
    total_count = count_result.scalar() or 0

    # Get unique values with limit
    query = text(f"""
        SELECT DISTINCT properties->>:field_name as value
        FROM "{dataset.table_name}"
        WHERE properties->>:field_name IS NOT NULL
        ORDER BY value
        LIMIT :limit
    """)

    result = await db.execute(query, {"field_name": field_name, "limit": limit})
    rows = result.fetchall()

    values = []
    for row in rows:
        val = row[0]
        values.append(val)  # Keep as string from JSONB ->> operator

    return values, total_count


async def _get_external_unique_values(
    dataset: Dataset,
    field_name: str,
    limit: int = 100,
) -> tuple[list[Any], int]:
    """Fetch unique values from an external vector service."""
    from app.services.external_source import proxy_request

    if dataset.service_type == "arcgis_feature":
        url = (
            f"{dataset.service_url.rstrip('/')}/{dataset.service_layer_id or '0'}/query"
        )
        params = {
            "f": "json",
            "where": "1=1",
            "outFields": field_name,
            "returnDistinctValues": "true",
            "returnGeometry": "false",
            "orderByFields": field_name,
            "resultRecordCount": str(limit),
        }
        resp = await proxy_request(url, dataset.service_type, params)
        data = resp.json()
        features = data.get("features", [])
        values = []
        for feat in features:
            val = feat.get("attributes", {}).get(field_name)
            if val is not None:
                values.append(val)
        return values, len(values)

    elif dataset.service_type == "wfs":
        url = dataset.service_url
        params = {
            "service": "WFS",
            "request": "GetFeature",
            "typeName": dataset.service_layer_id or "",
            "outputFormat": "application/json",
            "propertyName": field_name,
            "maxFeatures": "2000",
            "srsName": "EPSG:4326",
        }
        resp = await proxy_request(url, dataset.service_type, params)
        data = resp.json()
        seen: set[Any] = set()
        values: list[Any] = []
        for feat in data.get("features", []):
            val = feat.get("properties", {}).get(field_name)
            if val is not None and val not in seen:
                seen.add(val)
                values.append(val)
        values.sort(key=lambda v: str(v))
        return values[:limit], len(values)

    return [], 0


async def get_field_statistics(
    db: AsyncSession,
    dataset: Dataset,
    field_name: str,
) -> dict[str, Any]:
    """Get statistics (min, max, mean) for a numeric field."""
    if not dataset.table_name or not _validate_table_name(dataset.table_name):
        return {"min": None, "max": None, "mean": None, "count": 0}

    if not _validate_field_name(field_name):
        return {"min": None, "max": None, "mean": None, "count": 0}

    query = text(f"""
        SELECT
            MIN((properties->>:field_name)::numeric) as min_val,
            MAX((properties->>:field_name)::numeric) as max_val,
            AVG((properties->>:field_name)::numeric) as mean_val,
            COUNT(*) as count
        FROM "{dataset.table_name}"
        WHERE properties->>:field_name IS NOT NULL
          AND properties->>:field_name ~ '^-?[0-9]+(\\.[0-9]+)?$'
    """)

    result = await db.execute(query, {"field_name": field_name})
    row = result.fetchone()

    if row:
        return {
            "min": float(row[0]) if row[0] is not None else None,
            "max": float(row[1]) if row[1] is not None else None,
            "mean": float(row[2]) if row[2] is not None else None,
            "count": row[3] or 0,
        }

    return {"min": None, "max": None, "mean": None, "count": 0}
