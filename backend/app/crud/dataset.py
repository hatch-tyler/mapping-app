import re
from datetime import datetime
from uuid import UUID
from typing import Any
from sqlalchemy import select, func, text, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.dataset import Dataset, UploadJob
from app.schemas.dataset import DatasetCreate, DatasetUpdate, ColumnFilter, FilterOperator


def _validate_table_name(table_name: str) -> bool:
    """Validate table name to prevent SQL injection."""
    return bool(re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', table_name))


def _validate_field_name(field_name: str) -> bool:
    """Validate field name for safe use in SQL."""
    return bool(re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', field_name))


async def get_dataset(db: AsyncSession, dataset_id: UUID) -> Dataset | None:
    result = await db.execute(select(Dataset).where(Dataset.id == dataset_id))
    return result.scalar_one_or_none()


async def get_datasets(
    db: AsyncSession,
    skip: int = 0,
    limit: int = 100,
    visible_only: bool = False,
) -> tuple[list[Dataset], int]:
    query = select(Dataset)
    count_query = select(func.count(Dataset.id))

    if visible_only:
        query = query.where(Dataset.is_visible == True)
        count_query = count_query.where(Dataset.is_visible == True)

    query = query.order_by(Dataset.created_at.desc()).offset(skip).limit(limit)

    result = await db.execute(query)
    datasets = list(result.scalars().all())

    count_result = await db.execute(count_query)
    total = count_result.scalar()

    return datasets, total


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
        created_by_id=created_by_id,
        **kwargs,
    )
    db.add(dataset)
    await db.commit()
    await db.refresh(dataset)
    return dataset


async def update_dataset(
    db: AsyncSession, dataset: Dataset, dataset_in: DatasetUpdate
) -> Dataset:
    update_data = dataset_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(dataset, field, value)

    await db.commit()
    await db.refresh(dataset)
    return dataset


async def delete_dataset(db: AsyncSession, dataset: Dataset) -> None:
    # If vector dataset, drop the data table
    if dataset.table_name:
        await db.execute(text(f'DROP TABLE IF EXISTS "{dataset.table_name}" CASCADE'))

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
    skip: int = 0,
    limit: int = 100,
) -> tuple[list[Dataset], int]:
    """Get datasets that are browsable based on authentication status.

    - Anonymous users: only public datasets (is_public=True)
    - Authenticated users: all visible datasets (is_visible=True)
    """
    query = select(Dataset)
    count_query = select(func.count(Dataset.id))

    if user_authenticated:
        # Authenticated users see all visible datasets
        query = query.where(Dataset.is_visible == True)
        count_query = count_query.where(Dataset.is_visible == True)
    else:
        # Anonymous users only see public datasets
        query = query.where(Dataset.is_public == True)
        count_query = count_query.where(Dataset.is_public == True)

    query = query.order_by(Dataset.created_at.desc()).offset(skip).limit(limit)

    result = await db.execute(query)
    datasets = list(result.scalars().all())

    count_result = await db.execute(count_query)
    total = count_result.scalar()

    return datasets, total


async def get_dataset_fields(
    db: AsyncSession,
    dataset: Dataset,
) -> list[dict[str, str]]:
    """Introspect JSONB properties to get field names and types."""
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
            field_accessor = f"(properties->>'{f.field}')"

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
                where_clauses.append(f"LOWER({field_accessor}) LIKE LOWER(:{param_name})")
                params[param_name] = f"%{f.value}%"
            elif f.operator == FilterOperator.startswith:
                where_clauses.append(f"LOWER({field_accessor}) LIKE LOWER(:{param_name})")
                params[param_name] = f"{f.value}%"

    where_sql = " AND ".join(where_clauses) if where_clauses else "1=1"

    # Count total matching rows
    count_query = text(f"""
        SELECT COUNT(*) FROM "{dataset.table_name}"
        WHERE {where_sql}
    """)
    count_result = await db.execute(count_query, params)
    total_count = count_result.scalar() or 0

    # Build ORDER BY clause
    order_sql = "id ASC"
    if sort_field:
        if sort_field == "id":
            order_sql = f"id {sort_order.upper()}"
        elif _validate_field_name(sort_field):
            order_sql = f"properties->>'{sort_field}' {sort_order.upper()}"

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

    # Convert to tuple for SQL IN clause
    ids_str = ",".join(str(int(fid)) for fid in feature_ids)

    if include_geometry:
        query = text(f"""
            SELECT id, properties, ST_AsGeoJSON(geom)::jsonb as geometry
            FROM "{dataset.table_name}"
            WHERE id IN ({ids_str})
        """)
    else:
        query = text(f"""
            SELECT id, properties
            FROM "{dataset.table_name}"
            WHERE id IN ({ids_str})
        """)

    result = await db.execute(query)
    rows = result.fetchall()

    if include_geometry:
        return [{"id": row[0], "properties": row[1] or {}, "geometry": row[2]} for row in rows]
    else:
        return [{"id": row[0], "properties": row[1] or {}} for row in rows]


async def get_unique_field_values(
    db: AsyncSession,
    dataset: Dataset,
    field_name: str,
    limit: int = 100,
) -> tuple[list[Any], int]:
    """Get unique values for a specific field in a dataset."""
    if not dataset.table_name or not _validate_table_name(dataset.table_name):
        return [], 0

    if not _validate_field_name(field_name):
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

    # Try to parse numeric values
    values = []
    for row in rows:
        val = row[0]
        if val is not None:
            # Try to parse as number
            try:
                if '.' in val:
                    values.append(float(val))
                else:
                    values.append(int(val))
            except (ValueError, TypeError):
                values.append(val)
        else:
            values.append(None)

    return values, total_count


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
