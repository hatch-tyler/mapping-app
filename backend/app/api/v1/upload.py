import asyncio
import hashlib
import json
import shutil
import uuid
from datetime import datetime, timedelta, timezone
from typing import Callable
from uuid import UUID
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.dataset import (
    DatasetCreate,
    UploadJobResponse,
    BundleInspectResponse,
    BundleUploadResponse,
    BundleStatusResponse,
    BundleJobDetail,
    BundleSummary,
    DetectedDatasetSchema,
    BundleDatasetMetadata,
)
from app.crud import dataset as dataset_crud
from app.api.deps import get_current_editor_or_admin_user
from app.models.user import User
from app.models.dataset import Dataset, UploadJob
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


def _fail_job_on_crash(job_id: UUID) -> Callable[[asyncio.Task], None]:
    """Callback that marks the UploadJob `failed` if its background task crashes.

    Without this, a task that dies from an uncaught exception leaves the job
    row stuck in `pending`/`processing` forever. The lifespan startup has a
    similar sweeper for worker restarts; this handles the in-process case.
    """

    def _cb(task: asyncio.Task) -> None:
        if task.cancelled():
            return
        exc = task.exception()
        if not exc:
            return
        logger.error(
            "Background job %s crashed: %s", job_id, exc, exc_info=exc
        )
        asyncio.create_task(_mark_job_failed(job_id, str(exc)[:1000]))

    return _cb


async def _mark_job_failed(job_id: UUID, message: str) -> None:
    """Open a fresh session and mark the job `failed` with an error message."""
    from app.database import AsyncSessionLocal

    try:
        async with AsyncSessionLocal() as db:
            job = await dataset_crud.get_upload_job(db, job_id)
            if job and job.status not in ("completed", "failed"):
                await dataset_crud.update_upload_job(
                    db, job, status="failed", error_message=message
                )
    except Exception:
        logger.exception("Failed to mark job %s as failed", job_id)


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

    # Fast prelude: create Dataset + UploadJob rows for every included dataset
    # (status=pending). All extraction and processing happens in a single
    # background task that runs through the dataset list sequentially, which
    # keeps peak memory bounded to one dataset at a time (prior versions ran
    # every dataset's processing concurrently, which was the OOM root cause
    # for large bundles).
    created_jobs: list[UploadJobResponse] = []
    plan: list[tuple[UUID, UUID, object, str]] = []  # (dataset_id, job_id, det, primary_file)

    for meta in included:
        det = detected_by_primary.get(meta.primary_file)
        if det is None:
            logger.warning(
                "Bundle %s: client requested %s which was not detected; skipping",
                bundle_id,
                meta.primary_file,
            )
            continue

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
            logger.info(
                "Skipping duplicate dataset in bundle %s: %s (hash match)",
                bundle_id,
                det.primary_file,
            )
            continue

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
        job = await dataset_crud.create_upload_job(
            db, dataset.id, bundle_id=bundle_id
        )
        created_jobs.append(UploadJobResponse.model_validate(job))
        plan.append((dataset.id, job.id, det, det.primary_file))

    if not created_jobs:
        shutil.rmtree(str(bundle_dir), ignore_errors=True)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No datasets were created (all selected datasets were duplicates or invalid)",
        )

    # Kick off a single background task that processes the whole bundle
    # sequentially. Any crash in it marks whichever job was in flight as
    # failed; the lifespan sweeper catches worker-restart cases.
    task = asyncio.create_task(
        _process_bundle_sequentially(bundle_id, bundle_dir, zip_path, plan)
    )
    task.add_done_callback(_log_task_error)

    return BundleUploadResponse(bundle_id=bundle_id, jobs=created_jobs)


async def _process_bundle_sequentially(
    bundle_id: UUID,
    bundle_dir: Path,
    zip_path: Path,
    plan: list[tuple[UUID, UUID, object, str]],
) -> None:
    """Extract and process each dataset in the bundle one at a time.

    Sequential processing keeps peak memory predictable (one dataset's worth
    of geopandas / GDAL state in RAM at a time) which is the primary
    mitigation for the prior worker-OOM 502 incidents on large bundles.
    """
    try:
        for dataset_id, job_id, det, primary_file in plan:
            try:
                job_dir = bundle_dir / str(job_id)
                primary_path = await asyncio.to_thread(
                    FileProcessor.extract_members_to_dir,
                    zip_path,
                    det.member_files,
                    job_dir,
                )
                if det.data_type == "vector":
                    await file_processor.process_vector_background(
                        primary_path, dataset_id, job_id
                    )
                else:
                    await file_processor.process_raster_background(
                        primary_path, dataset_id, job_id
                    )
            except Exception as e:
                logger.exception(
                    "Bundle %s: failed to process %s (job %s): %s",
                    bundle_id,
                    primary_file,
                    job_id,
                    e,
                )
                await _mark_job_failed(
                    job_id, f"Failed to process from bundle: {e}"[:1000]
                )
    finally:
        # All datasets processed (or crashed); the ZIP + bundle dir are no
        # longer needed. Per-job extraction dirs inside bundle_dir may still
        # be referenced by process_vector/raster copies, but each processor
        # handles its own cleanup of temp state.
        try:
            if zip_path.exists():
                zip_path.unlink()
        except OSError:
            pass


# ===== Bundle recovery endpoints =====
#
# These exist so the frontend can reconcile a bundle upload even if the
# original POST response was lost (nginx 502, client disconnect, etc.). The
# backend commits every Dataset + UploadJob row before kicking off the
# background processor, so those rows are retrievable by bundle_id.


@router.get("/bundles/{bundle_id}", response_model=BundleStatusResponse)
async def get_bundle_status(
    bundle_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_editor_or_admin_user),
):
    """Return per-dataset status for a bundle upload, joined with dataset names.

    Authorization: the caller must have created at least one dataset in the
    bundle, OR be an admin. Bundles are small and there's no public view.
    """
    rows = await db.execute(
        select(UploadJob, Dataset)
        .join(Dataset, Dataset.id == UploadJob.dataset_id)
        .where(UploadJob.bundle_id == bundle_id)
        .order_by(UploadJob.created_at)
    )
    pairs = list(rows.all())
    if not pairs:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Bundle not found",
        )

    # Authorization — admin OR uploaded one of the datasets themselves.
    if not current_user.is_admin:
        caller_owns = any(
            getattr(d, "created_by_id", None) == current_user.id for (_j, d) in pairs
        )
        if not caller_owns:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to view this bundle",
            )

    return BundleStatusResponse(
        bundle_id=bundle_id,
        jobs=[
            BundleJobDetail(
                id=job.id,
                dataset_id=job.dataset_id,
                dataset_name=dataset.name,
                status=job.status,
                progress=job.progress,
                error_message=job.error_message,
                created_at=job.created_at,
                completed_at=job.completed_at,
            )
            for (job, dataset) in pairs
        ],
    )


@router.get("/bundles", response_model=list[BundleSummary])
async def list_recent_bundles(
    since_minutes: int = Query(60, ge=1, le=1440),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_editor_or_admin_user),
):
    """Return compact summaries of bundles uploaded by the current user within
    the given window. Used by the frontend to recover from a lost POST
    response: if a bundle is in-flight and its bundle_id wasn't received, the
    UI can call this and continue polling.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=since_minutes)
    rows = await db.execute(
        select(UploadJob, Dataset)
        .join(Dataset, Dataset.id == UploadJob.dataset_id)
        .where(UploadJob.bundle_id.isnot(None))
        .where(UploadJob.created_at >= cutoff)
        .where(Dataset.created_by_id == current_user.id)
        .order_by(UploadJob.created_at.desc())
    )
    # Group by bundle_id
    groups: dict[UUID, list[tuple]] = {}
    for job, dataset in rows.all():
        assert job.bundle_id is not None
        groups.setdefault(job.bundle_id, []).append((job, dataset))

    summaries: list[BundleSummary] = []
    for bid, items in groups.items():
        jobs = [j for (j, _d) in items]
        total = len(jobs)
        completed = sum(1 for j in jobs if j.status == "completed")
        failed = sum(1 for j in jobs if j.status == "failed")
        in_progress = total - completed - failed
        created_at = min(j.created_at for j in jobs)
        summaries.append(
            BundleSummary(
                bundle_id=bid,
                created_at=created_at,
                total=total,
                completed=completed,
                failed=failed,
                in_progress=in_progress,
            )
        )

    summaries.sort(key=lambda s: s.created_at, reverse=True)
    return summaries
