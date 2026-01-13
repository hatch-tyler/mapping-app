from uuid import UUID
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.dataset import Dataset, UploadJob
from app.schemas.dataset import DatasetCreate, DatasetUpdate


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
) -> UploadJob:
    if status is not None:
        job.status = status
    if progress is not None:
        job.progress = progress
    if error_message is not None:
        job.error_message = error_message

    await db.commit()
    await db.refresh(job)
    return job
