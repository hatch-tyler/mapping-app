import asyncio
import hashlib
import shutil
from uuid import UUID
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.dataset import DatasetCreate, UploadJobResponse
from app.crud import dataset as dataset_crud
from app.api.deps import get_current_admin_user
from app.models.user import User
from app.models.dataset import Dataset
from app.services.file_processor import file_processor, FileProcessor
from app.config import settings

router = APIRouter(prefix="/upload", tags=["upload"])

import logging

logger = logging.getLogger(__name__)


def _log_task_error(task: asyncio.Task) -> None:
    """Callback to log unhandled exceptions from background tasks."""
    if task.cancelled():
        return
    exc = task.exception()
    if exc:
        logger.error("Background processing task failed: %s", exc, exc_info=exc)


def _processing_dir(job_id: UUID) -> Path:
    """Return a persistent directory for a processing job's files."""
    d = Path(settings.UPLOAD_DIR) / "processing" / str(job_id)
    d.mkdir(parents=True, exist_ok=True)
    return d


@router.post("/vector", response_model=UploadJobResponse, status_code=202)
async def upload_vector(
    file: UploadFile = File(...),
    name: str = Form(...),
    description: str = Form(None),
    category: str = Form("reference"),
    geographic_scope: str | None = Form(None),
    project_id: str | None = Form(None),
    tags: str = Form(""),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No filename provided",
        )

    ext = FileProcessor.get_file_extension(file.filename)
    if not FileProcessor.is_vector_file(file.filename):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file format: {ext}. Supported: {FileProcessor.SUPPORTED_VECTOR}",
        )

    # Read file content for hashing
    file_content = await file.read()
    file_hash = hashlib.sha256(file_content).hexdigest()
    await file.seek(0)  # Reset for later reading

    # Check for duplicates
    dup_result = await db.execute(
        select(Dataset).where(Dataset.file_hash == file_hash).limit(1)
    )
    duplicate = dup_result.scalar_one_or_none()

    # Parse tags from comma-separated string
    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else []

    # Create dataset record
    dataset_in = DatasetCreate(
        name=name, description=description,
        category=category, geographic_scope=geographic_scope, tags=tag_list,
    )
    extra_kwargs = {}
    if project_id:
        from uuid import UUID as PyUUID
        extra_kwargs["project_id"] = PyUUID(project_id)
    dataset = await dataset_crud.create_dataset(
        db,
        dataset_in,
        data_type="vector",
        source_format=ext.lstrip("."),
        created_by_id=current_user.id,
        file_hash=file_hash,
        **extra_kwargs,
    )

    # Create upload job
    job = await dataset_crud.create_upload_job(db, dataset.id)

    # Save file to persistent processing directory
    proc_dir = _processing_dir(job.id)
    file_path = proc_dir / file.filename

    max_bytes = settings.UPLOAD_MAX_SIZE_MB * 1024 * 1024
    try:
        size = 0
        with open(file_path, "wb") as buffer:
            while chunk := await file.read(1024 * 1024):  # 1MB chunks
                size += len(chunk)
                if size > max_bytes:
                    buffer.close()
                    shutil.rmtree(str(proc_dir), ignore_errors=True)
                    await dataset_crud.delete_dataset(db, dataset)
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail=f"File exceeds maximum size of {settings.UPLOAD_MAX_SIZE_MB}MB",
                    )
                buffer.write(chunk)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to save uploaded file: %s", e)
        shutil.rmtree(str(proc_dir), ignore_errors=True)
        await dataset_crud.delete_dataset(db, dataset)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save uploaded file",
        )

    # Spawn background processing with error logging
    task = asyncio.create_task(
        file_processor.process_vector_background(file_path, dataset.id, job.id)
    )
    task.add_done_callback(_log_task_error)

    return job


@router.post("/raster", response_model=UploadJobResponse, status_code=202)
async def upload_raster(
    file: UploadFile = File(...),
    name: str = Form(...),
    description: str = Form(None),
    category: str = Form("reference"),
    geographic_scope: str | None = Form(None),
    project_id: str | None = Form(None),
    tags: str = Form(""),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No filename provided",
        )

    ext = FileProcessor.get_file_extension(file.filename)
    if not FileProcessor.is_raster_file(file.filename):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file format: {ext}. Supported: {FileProcessor.SUPPORTED_RASTER}",
        )

    # Read file content for hashing
    file_content = await file.read()
    file_hash = hashlib.sha256(file_content).hexdigest()
    await file.seek(0)  # Reset for later reading

    # Check for duplicates
    dup_result = await db.execute(
        select(Dataset).where(Dataset.file_hash == file_hash).limit(1)
    )
    duplicate = dup_result.scalar_one_or_none()

    # Parse tags from comma-separated string
    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else []

    # Create dataset record
    dataset_in = DatasetCreate(
        name=name, description=description,
        category=category, geographic_scope=geographic_scope, tags=tag_list,
    )
    extra_kwargs = {}
    if project_id:
        from uuid import UUID as PyUUID
        extra_kwargs["project_id"] = PyUUID(project_id)
    dataset = await dataset_crud.create_dataset(
        db,
        dataset_in,
        data_type="raster",
        source_format=ext.lstrip("."),
        created_by_id=current_user.id,
        file_hash=file_hash,
        **extra_kwargs,
    )

    # Create upload job
    job = await dataset_crud.create_upload_job(db, dataset.id)

    # Save file to persistent processing directory
    proc_dir = _processing_dir(job.id)
    file_path = proc_dir / file.filename

    max_bytes = settings.UPLOAD_MAX_SIZE_MB * 1024 * 1024
    try:
        size = 0
        with open(file_path, "wb") as buffer:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > max_bytes:
                    buffer.close()
                    shutil.rmtree(str(proc_dir), ignore_errors=True)
                    await dataset_crud.delete_dataset(db, dataset)
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail=f"File exceeds maximum size of {settings.UPLOAD_MAX_SIZE_MB}MB",
                    )
                buffer.write(chunk)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to save uploaded file: %s", e)
        shutil.rmtree(str(proc_dir), ignore_errors=True)
        await dataset_crud.delete_dataset(db, dataset)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save uploaded file",
        )

    task = asyncio.create_task(
        file_processor.process_raster_background(file_path, dataset.id, job.id)
    )
    task.add_done_callback(_log_task_error)

    return job


@router.get("/status/{job_id}", response_model=UploadJobResponse)
async def get_upload_status(
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    job = await dataset_crud.get_upload_job(db, job_id)
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Upload job not found",
        )
    return job
