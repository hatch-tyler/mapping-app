import asyncio
import hashlib
import json
import shutil
import uuid
from uuid import UUID
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.dataset import (
    DatasetCreate,
    UploadJobResponse,
    BundleInspectResponse,
    BundleUploadResponse,
    DetectedDatasetSchema,
    BundleDatasetMetadata,
)
from app.crud import dataset as dataset_crud
from app.api.deps import get_current_editor_or_admin_user
from app.models.user import User
from app.models.dataset import Dataset
from app.services.file_processor import file_processor, FileProcessor
from app.services.zip_inspector import inspect_zip
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
    current_user: User = Depends(get_current_editor_or_admin_user),
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
    existing = dup_result.scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"This file has already been uploaded as dataset '{existing.name}'",
        )

    # Parse tags from comma-separated string
    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else []

    # Create dataset record
    dataset_in = DatasetCreate(
        name=name,
        description=description,
        category=category,
        geographic_scope=geographic_scope,
        tags=tag_list,
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
    current_user: User = Depends(get_current_editor_or_admin_user),
):
    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No filename provided",
        )

    ext = FileProcessor.get_file_extension(file.filename)
    if not FileProcessor.is_raster_file(file.filename) and ext != ".zip":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file format: {ext}. Supported: {FileProcessor.SUPPORTED_RASTER} or .zip archive",
        )

    # Sidecar-dependent raster formats cannot be uploaded as bare files
    sidecar_formats = {".asc", ".bil", ".bip", ".bsq", ".flt"}
    if ext in sidecar_formats:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"{ext} format requires sidecar files (.prj, .hdr) for spatial reference. "
                "Please upload as a ZIP archive containing the raster file and all required sidecar files."
            ),
        )

    # Read file content for hashing
    file_content = await file.read()
    file_hash = hashlib.sha256(file_content).hexdigest()
    await file.seek(0)  # Reset for later reading

    # Check for duplicates
    dup_result = await db.execute(
        select(Dataset).where(Dataset.file_hash == file_hash).limit(1)
    )
    existing = dup_result.scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"This file has already been uploaded as dataset '{existing.name}'",
        )

    # Parse tags from comma-separated string
    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else []

    # Create dataset record
    dataset_in = DatasetCreate(
        name=name,
        description=description,
        category=category,
        geographic_scope=geographic_scope,
        tags=tag_list,
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
    current_user: User = Depends(get_current_editor_or_admin_user),
):
    job = await dataset_crud.get_upload_job(db, job_id)
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Upload job not found",
        )
    return job


# ===== Multi-Dataset Bundle Upload =====


async def _save_upload_to_temp(file: UploadFile, dest: Path) -> int:
    """Stream an UploadFile to disk in 1MB chunks, enforcing the size limit.

    Returns the number of bytes written. Raises HTTP 413 if the limit is exceeded.
    """
    max_bytes = settings.UPLOAD_MAX_SIZE_MB * 1024 * 1024
    size = 0
    with open(dest, "wb") as buffer:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > max_bytes:
                buffer.close()
                try:
                    dest.unlink()
                except FileNotFoundError:
                    pass
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail=f"File exceeds maximum size of {settings.UPLOAD_MAX_SIZE_MB}MB",
                )
            buffer.write(chunk)
    return size


@router.post("/inspect", response_model=BundleInspectResponse)
async def inspect_bundle(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_editor_or_admin_user),
):
    """Inspect a ZIP archive and list the datasets found inside.

    Does not create any database rows. Used by the upload UI to preview
    what will be imported before the user commits.
    """
    if not file.filename or FileProcessor.get_file_extension(file.filename) != ".zip":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Inspection requires a .zip file",
        )

    tmp_dir = Path(settings.UPLOAD_DIR) / "inspect" / str(uuid.uuid4())
    tmp_dir.mkdir(parents=True, exist_ok=True)
    zip_path = tmp_dir / file.filename
    try:
        await _save_upload_to_temp(file, zip_path)
        detected = await asyncio.to_thread(inspect_zip, zip_path)
        return BundleInspectResponse(
            datasets=[DetectedDatasetSchema(**d.__dict__) for d in detected]
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Bundle inspection failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to inspect ZIP: {e}",
        )
    finally:
        shutil.rmtree(str(tmp_dir), ignore_errors=True)


@router.post("/bundle", response_model=BundleUploadResponse, status_code=202)
async def upload_bundle(
    file: UploadFile = File(...),
    datasets: str = Form(...),  # JSON array of BundleDatasetMetadata
    category: str = Form("reference"),
    geographic_scope: str | None = Form(None),
    project_id: str | None = Form(None),
    tags: str = Form(""),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_editor_or_admin_user),
):
    """Upload a ZIP containing multiple datasets.

    Each included dataset becomes its own Dataset row and UploadJob, sharing
    a bundle_id so the UI can track them as a group.
    """
    if not file.filename or FileProcessor.get_file_extension(file.filename) != ".zip":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Bundle upload requires a .zip file",
        )

    # Parse and validate per-dataset metadata
    try:
        raw = json.loads(datasets)
        client_meta = [BundleDatasetMetadata(**d) for d in raw]
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid datasets metadata: {e}",
        )

    included = [m for m in client_meta if m.include]
    if not included:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one dataset must be included",
        )

    # Save ZIP to a shared bundle directory (extracted per-job below)
    bundle_id = uuid.uuid4()
    bundle_dir = Path(settings.UPLOAD_DIR) / "bundles" / str(bundle_id)
    bundle_dir.mkdir(parents=True, exist_ok=True)
    zip_path = bundle_dir / file.filename

    try:
        await _save_upload_to_temp(file, zip_path)
    except HTTPException:
        shutil.rmtree(str(bundle_dir), ignore_errors=True)
        raise

    # Re-run detection server-side — authoritative source of truth
    try:
        detected = await asyncio.to_thread(inspect_zip, zip_path)
    except Exception as e:
        shutil.rmtree(str(bundle_dir), ignore_errors=True)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to inspect ZIP: {e}",
        )
    detected_by_primary = {d.primary_file: d for d in detected}

    # Parse tags and project_id
    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else []
    proj_uuid: UUID | None = None
    if project_id:
        try:
            proj_uuid = UUID(project_id)
        except ValueError:
            shutil.rmtree(str(bundle_dir), ignore_errors=True)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid project_id",
            )

    created_jobs: list[UploadJobResponse] = []

    for meta in included:
        det = detected_by_primary.get(meta.primary_file)
        if det is None:
            logger.warning(
                "Bundle %s: client requested %s which was not detected; skipping",
                bundle_id,
                meta.primary_file,
            )
            continue

        # Hash the group's combined bytes so duplicates across bundles are still caught.
        # For simplicity we use the primary file only — matches how the backend
        # currently fingerprints uploads (one hash per dataset).
        try:
            import zipfile

            with zipfile.ZipFile(str(zip_path), "r") as zf:
                with zf.open(det.primary_file) as f:
                    file_hash = hashlib.sha256(f.read()).hexdigest()
        except Exception as e:
            logger.exception("Failed to hash %s: %s", det.primary_file, e)
            continue

        dup = await db.execute(
            select(Dataset).where(Dataset.file_hash == file_hash).limit(1)
        )
        if dup.scalar_one_or_none() is not None:
            # Skip duplicates silently — don't abort the whole bundle
            logger.info(
                "Skipping duplicate dataset in bundle %s: %s (hash match)",
                bundle_id,
                det.primary_file,
            )
            continue

        # Create dataset
        dataset_in = DatasetCreate(
            name=meta.name,
            description=meta.description,
            category=category,
            geographic_scope=geographic_scope,
            tags=tag_list,
        )
        extra: dict = {}
        if proj_uuid is not None:
            extra["project_id"] = proj_uuid

        dataset = await dataset_crud.create_dataset(
            db,
            dataset_in,
            data_type=det.data_type,
            source_format=det.format,
            created_by_id=current_user.id,
            file_hash=file_hash,
            **extra,
        )

        # Create job linked to the bundle
        job = await dataset_crud.create_upload_job(db, dataset.id, bundle_id=bundle_id)

        # Prepare per-job extraction dir and spawn background processing
        job_dir = bundle_dir / str(job.id)
        try:
            primary_path = await asyncio.to_thread(
                FileProcessor.extract_members_to_dir,
                zip_path,
                det.member_files,
                job_dir,
            )
        except Exception as e:
            logger.exception(
                "Failed to extract bundle member %s: %s", det.primary_file, e
            )
            await dataset_crud.update_upload_job(
                db,
                job,
                status="failed",
                error_message=f"Failed to extract from ZIP: {e}",
            )
            created_jobs.append(UploadJobResponse.model_validate(job))
            continue

        if det.data_type == "vector":
            task = asyncio.create_task(
                file_processor.process_vector_background(
                    primary_path, dataset.id, job.id
                )
            )
        else:
            task = asyncio.create_task(
                file_processor.process_raster_background(
                    primary_path, dataset.id, job.id
                )
            )
        task.add_done_callback(_log_task_error)
        created_jobs.append(UploadJobResponse.model_validate(job))

    if not created_jobs:
        shutil.rmtree(str(bundle_dir), ignore_errors=True)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No datasets were created (all selected datasets were duplicates or invalid)",
        )

    # ZIP contents already extracted per-job; drop the original to save space.
    try:
        zip_path.unlink()
    except OSError:
        pass

    return BundleUploadResponse(bundle_id=bundle_id, jobs=created_jobs)
