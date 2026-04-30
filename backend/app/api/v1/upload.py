import asyncio
import hashlib
import json
import shutil
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable
from uuid import UUID
from pathlib import Path
from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    status,
    UploadFile,
    File,
    Form,
    Query,
)
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
from app.services.zip_inspector import inspect_zip, DetectedDataset
from app.services import upload_workspace
from app.config import settings

router = APIRouter(prefix="/upload", tags=["upload"])

import logging

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class BundleProcessPlan:
    """One entry in the bundle's per-job processing plan.

    Created up-front at /upload/bundle (one per included DetectedDataset)
    and consumed sequentially by ``_process_bundle_sequentially``.
    """

    dataset_id: UUID
    job_id: UUID
    detected: DetectedDataset

    @property
    def primary_file(self) -> str:
        # Convenience for logs / error messages.
        return self.detected.primary_file


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
        logger.error("Background job %s crashed: %s", job_id, exc, exc_info=exc)
        asyncio.create_task(_mark_job_failed(job_id, str(exc)[:1000]))

    return _cb


async def _mark_job_failed(
    job_id: UUID,
    message: str,
    error_code: str | None = None,
) -> None:
    """Open a fresh session and mark the job `failed` with an error message.

    ``error_code`` should be a value from
    ``app.services.upload_errors.UploadErrorCode``; defaults to
    ``PROCESSING_FAILED`` if not supplied.
    """
    from app.database import AsyncSessionLocal
    from app.services.upload_errors import UploadErrorCode

    try:
        async with AsyncSessionLocal() as db:
            job = await dataset_crud.get_upload_job(db, job_id)
            if job and job.status not in ("completed", "failed"):
                await dataset_crud.update_upload_job(
                    db,
                    job,
                    status="failed",
                    error_message=message,
                    error_code=error_code or UploadErrorCode.PROCESSING_FAILED.value,
                )
    except Exception:
        logger.exception("Failed to mark job %s as failed", job_id)


def _processing_dir(job_id: UUID) -> Path:
    """Return the per-job processing directory (delegates to upload_workspace)."""
    return upload_workspace.processing_dir(job_id)


def _validate_single_file_upload(file: UploadFile, data_type: str) -> str:
    """Validate filename and extension for a single-file upload.

    Returns the (lowercase, dotted) extension. Raises HTTPException on bad input.
    """
    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No filename provided",
        )

    ext = FileProcessor.get_file_extension(file.filename)
    if data_type == "vector":
        if not FileProcessor.is_vector_file(file.filename):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Unsupported file format: {ext}. "
                    f"Supported: {FileProcessor.SUPPORTED_VECTOR}"
                ),
            )
    elif data_type == "raster":
        if not FileProcessor.is_raster_file(file.filename) and ext != ".zip":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Unsupported file format: {ext}. "
                    f"Supported: {FileProcessor.SUPPORTED_RASTER} or .zip archive"
                ),
            )
        # Sidecar-dependent raster formats cannot be uploaded as bare files —
        # they need .hdr / .prj which only ride along inside a ZIP.
        if ext in FileProcessor.SIDECAR_DEPENDENT_RASTER:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"{ext} format requires sidecar files (.prj, .hdr) for "
                    "spatial reference. Please upload as a ZIP archive "
                    "containing the raster file and all required sidecar files."
                ),
            )
    else:
        raise ValueError(f"Unknown data_type: {data_type}")
    return ext


async def _stream_save_with_size_limit(file: UploadFile, dest: Path) -> None:
    """Stream an UploadFile to ``dest`` in 1 MB chunks, enforcing the size cap.

    Raises HTTP 413 if the size limit is exceeded; the caller is responsible
    for cleaning up partial files when an exception escapes.
    """
    max_bytes = settings.UPLOAD_MAX_SIZE_MB * 1024 * 1024
    size = 0
    with open(dest, "wb") as buffer:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > max_bytes:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail=(
                        f"File exceeds maximum size of "
                        f"{settings.UPLOAD_MAX_SIZE_MB}MB"
                    ),
                )
            buffer.write(chunk)


async def _save_validate_create_dataset(
    *,
    file: UploadFile,
    data_type: str,
    name: str,
    description: str | None,
    category: str,
    geographic_scope: str | None,
    project_id: str | None,
    tags: str,
    db: AsyncSession,
    current_user: User,
) -> UploadJob:
    """Shared core for /upload/vector and /upload/raster.

    Owns: extension validation, hash + duplicate check, dataset + upload-job
    row creation, streamed-to-disk save with size cap, background task spawn
    with crash-marks-failed callback. Returns the freshly created UploadJob.
    """
    ext = _validate_single_file_upload(file, data_type)

    file_content = await file.read()
    file_hash = hashlib.sha256(file_content).hexdigest()
    await file.seek(0)

    dup_result = await db.execute(
        select(Dataset).where(Dataset.file_hash == file_hash).limit(1)
    )
    existing = dup_result.scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"This file has already been uploaded as dataset '{existing.name}'",
        )

    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else []

    dataset_in = DatasetCreate(
        name=name,
        description=description,
        category=category,
        geographic_scope=geographic_scope,
        tags=tag_list,
    )
    extra_kwargs: dict = {}
    if project_id:
        try:
            extra_kwargs["project_id"] = UUID(project_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid project_id",
            )

    dataset = await dataset_crud.create_dataset(
        db,
        dataset_in,
        data_type=data_type,
        source_format=ext.lstrip("."),
        created_by_id=current_user.id,
        file_hash=file_hash,
        **extra_kwargs,
    )
    job = await dataset_crud.create_upload_job(db, dataset.id)

    proc_dir = _processing_dir(job.id)
    file_path = proc_dir / (file.filename or "upload")
    try:
        await _stream_save_with_size_limit(file, file_path)
    except HTTPException:
        shutil.rmtree(str(proc_dir), ignore_errors=True)
        await dataset_crud.delete_dataset(db, dataset)
        raise
    except Exception as e:
        logger.exception("Failed to save uploaded file: %s", e)
        shutil.rmtree(str(proc_dir), ignore_errors=True)
        await dataset_crud.delete_dataset(db, dataset)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save uploaded file",
        )

    if data_type == "vector":
        coro = file_processor.process_vector_background(file_path, dataset.id, job.id)
    else:
        coro = file_processor.process_raster_background(file_path, dataset.id, job.id)
    task = asyncio.create_task(coro)
    # Mark the job failed if the background task dies from an uncaught
    # exception — without this it would sit stuck in pending/processing.
    task.add_done_callback(_fail_job_on_crash(job.id))

    return job


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
    return await _save_validate_create_dataset(
        file=file,
        data_type="vector",
        name=name,
        description=description,
        category=category,
        geographic_scope=geographic_scope,
        project_id=project_id,
        tags=tags,
        db=db,
        current_user=current_user,
    )


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
    return await _save_validate_create_dataset(
        file=file,
        data_type="raster",
        name=name,
        description=description,
        category=category,
        geographic_scope=geographic_scope,
        project_id=project_id,
        tags=tags,
        db=db,
        current_user=current_user,
    )


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


def _hash_detected_dataset(zip_path: Path, det: DetectedDataset) -> str:
    """Compute the deduplication hash for a detected dataset within a bundle.

    For plain-file datasets (``entry_path`` set), hashes the entry's content.
    For container-layer datasets (``.gdb`` / ``.lpk`` — ``entry_path`` is None),
    streams every member's content in sorted order and mixes in ``layer_name``
    so two layers from the same .gdb get distinct hashes.
    """
    import zipfile

    with zipfile.ZipFile(str(zip_path), "r") as zf:
        if det.entry_path is not None:
            with zf.open(det.entry_path) as f:
                return hashlib.sha256(f.read()).hexdigest()
        h = hashlib.sha256()
        for member in sorted(det.member_files):
            with zf.open(member) as f:
                for chunk in iter(lambda: f.read(1024 * 1024), b""):
                    h.update(chunk)
        h.update(b"\x00")
        h.update((det.layer_name or "").encode("utf-8"))
        return h.hexdigest()


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


_BUNDLE_EXTS = {".zip", ".lpk", ".lpkx"}


@router.post("/inspect", response_model=BundleInspectResponse)
async def inspect_bundle(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_editor_or_admin_user),
):
    """Inspect a ZIP / .gdb.zip / .lpk / .lpkx archive and list the datasets found inside.

    Does not create any database rows. Used by the upload UI to preview
    what will be imported before the user commits.
    """
    if (
        not file.filename
        or FileProcessor.get_file_extension(file.filename) not in _BUNDLE_EXTS
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Inspection requires a .zip, .lpk, or .lpkx file",
        )

    tmp_dir = upload_workspace.inspect_dir()
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
    client_nonce: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_editor_or_admin_user),
):
    """Upload a ZIP / .gdb.zip / .lpk / .lpkx containing multiple datasets.

    Each included dataset becomes its own Dataset row and UploadJob, sharing
    a bundle_id so the UI can track them as a group.
    """
    if (
        not file.filename
        or FileProcessor.get_file_extension(file.filename) not in _BUNDLE_EXTS
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Bundle upload requires a .zip, .lpk, or .lpkx file",
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
    bundle_dir = upload_workspace.bundle_dir(bundle_id)
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
    plan: list[BundleProcessPlan] = []

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
            file_hash = _hash_detected_dataset(zip_path, det)
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
            db, dataset.id, bundle_id=bundle_id, client_nonce=client_nonce
        )
        created_jobs.append(UploadJobResponse.model_validate(job))
        plan.append(
            BundleProcessPlan(dataset_id=dataset.id, job_id=job.id, detected=det)
        )

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


async def _resolve_container_layer(
    job_dir: Path,
    zip_path: Path,
    det: DetectedDataset,
) -> tuple[Path, str | None, str]:
    """Extract a container layer's data from the bundle ZIP.

    Returns ``(read_path, layer_name, kind)`` where:

    * ``read_path`` is the on-disk path that the file processor should read
      (a .gdb directory for GDB layers, a regular file for shapefile/raster
      sources extracted out of a .lpk).
    * ``layer_name`` is the OpenFileGDB layer name (vector/raster) or None
      for non-GDB sources.
    * ``kind`` is "vector" or "raster".

    Handles both top-level .gdb directories in the bundle ZIP and .lpk/.lpkx
    files that wrap a .gdb or shapefile/raster.
    """
    assert det.container_path is not None  # caller checks this
    container_path: str = det.container_path
    layer_name: str | None = det.layer_name
    fmt: str = det.format
    data_type: str = det.data_type
    member_files: list[str] = det.member_files

    # Extract all bundle-level members into the job dir, preserving the
    # directory tree so .gdb folders / .lpk files keep their layout.
    await asyncio.to_thread(
        FileProcessor.extract_members_preserving_tree,
        zip_path,
        member_files,
        job_dir,
    )

    # Case 1: top-level .gdb in the bundle ZIP. container_path points at it.
    if container_path.lower().endswith(".gdb"):
        gdb_on_disk = job_dir / container_path
        return gdb_on_disk, layer_name, data_type

    # Case 2: .lpk / .lpkx wrapping inner data.
    if container_path.lower().endswith((".lpk", ".lpkx")):
        lpk_on_disk = job_dir / container_path
        # Unzip the .lpk into a sibling directory.
        import zipfile

        lpk_extract_dir = job_dir / "_lpk_extracted"
        lpk_extract_dir.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(str(lpk_on_disk), "r") as zf:
            zf.extractall(str(lpk_extract_dir))

        # layer_name encoding for .lpk-wrapped sources:
        #   * "<inner_gdb_path>::<feature_class>"  for gdb-vector / gdb-raster
        #   * "<inner_path>"                       for shapefile / raster / etc.
        if fmt in ("gdb-vector", "gdb-raster") and layer_name and "::" in layer_name:
            inner_gdb_path, fc_name = layer_name.split("::", 1)
            return lpk_extract_dir / inner_gdb_path, fc_name, data_type

        # Leaf source (shapefile / raster / geopackage / geojson) inside the
        # .lpk. layer_name holds the inner path.
        inner_path = layer_name or ""
        return lpk_extract_dir / inner_path, None, data_type

    raise ValueError(f"Unsupported container_path: {container_path}")


async def _process_bundle_sequentially(
    bundle_id: UUID,
    bundle_dir: Path,
    zip_path: Path,
    plan: list[BundleProcessPlan],
) -> None:
    """Extract and process each dataset in the bundle one at a time.

    Sequential processing keeps peak memory predictable (one dataset's worth
    of geopandas / GDAL state in RAM at a time) which is the primary
    mitigation for the prior worker-OOM 502 incidents on large bundles.
    """
    try:
        for entry in plan:
            det = entry.detected
            try:
                job_dir = bundle_dir / str(entry.job_id)

                # Multi-layer container path: .gdb or .lpk
                if det.container_path is not None:
                    read_path, layer_name, kind = await _resolve_container_layer(
                        job_dir, zip_path, det
                    )
                    if kind == "vector":
                        await file_processor.process_vector_background(
                            read_path,
                            entry.dataset_id,
                            entry.job_id,
                            layer_name=layer_name,
                        )
                    else:
                        # GDB raster: route through the .gdb-aware extractor.
                        # Other rasters (shapefile-shaped containers don't have
                        # rasters; raster inside .lpk gets layer_name=None).
                        if layer_name is not None:
                            await file_processor.process_gdb_raster_layer_background(
                                read_path, layer_name, entry.dataset_id, entry.job_id
                            )
                        else:
                            await file_processor.process_raster_background(
                                read_path, entry.dataset_id, entry.job_id
                            )
                    continue

                # Standard single-file or shapefile-bundle path.
                primary_path = await asyncio.to_thread(
                    FileProcessor.extract_members_to_dir,
                    zip_path,
                    det.member_files,
                    job_dir,
                )
                if det.data_type == "vector":
                    await file_processor.process_vector_background(
                        primary_path, entry.dataset_id, entry.job_id
                    )
                else:
                    await file_processor.process_raster_background(
                        primary_path, entry.dataset_id, entry.job_id
                    )
            except Exception as e:
                logger.exception(
                    "Bundle %s: failed to process %s (job %s): %s",
                    bundle_id,
                    entry.primary_file,
                    entry.job_id,
                    e,
                )
                await _mark_job_failed(
                    entry.job_id, f"Failed to process from bundle: {e}"[:1000]
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
                error_code=job.error_code,
                created_at=job.created_at,
                completed_at=job.completed_at,
            )
            for (job, dataset) in pairs
        ],
    )


@router.get("/bundles/by-nonce/{nonce}", response_model=BundleStatusResponse)
async def get_bundle_by_nonce(
    nonce: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_editor_or_admin_user),
):
    """Look up a bundle by its client-supplied nonce.

    Used by the frontend to recover from a lost POST response (nginx 502,
    network drop) without the fragile timestamp-window matching that
    /upload/bundles/by-nonce replaces. The nonce is recorded on every
    UploadJob row in the bundle at /upload/bundle time. Returns the full
    per-dataset status, identical in shape to ``/upload/bundles/{bundle_id}``.

    Authorization: the caller must have created at least one dataset in the
    matched bundle, or be an admin.
    """
    rows = await db.execute(
        select(UploadJob, Dataset)
        .join(Dataset, Dataset.id == UploadJob.dataset_id)
        .where(UploadJob.client_nonce == nonce)
        .order_by(UploadJob.created_at)
    )
    pairs = list(rows.all())
    if not pairs:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No bundle found for that nonce",
        )

    if not current_user.is_admin:
        caller_owns = any(
            getattr(d, "created_by_id", None) == current_user.id for (_j, d) in pairs
        )
        if not caller_owns:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to view this bundle",
            )

    # All jobs share a bundle_id by construction (they came from one upload),
    # so take the first.
    bundle_id = pairs[0][0].bundle_id
    if bundle_id is None:
        # Defensive: a non-bundle single-file upload that somehow recorded a
        # nonce shouldn't surface here, but don't crash if it did.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No bundle found for that nonce",
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
                error_code=job.error_code,
                created_at=job.created_at,
                completed_at=job.completed_at,
            )
            for (job, dataset) in pairs
        ],
    )


@router.get("/bundles", response_model=list[BundleSummary])
async def list_recent_bundles(
    since_minutes: int = Query(60, ge=1, le=10080),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_editor_or_admin_user),
):
    """Return compact summaries of bundles uploaded by the current user within
    the given window.

    Two consumers:
    * Lost-POST recovery (frontend default): a 60-minute window matches a
      just-attempted bundle that didn't return its bundle_id.
    * History view: callers may pass up to 10080 minutes (7 days) to show
      recent uploads in the UI.
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
