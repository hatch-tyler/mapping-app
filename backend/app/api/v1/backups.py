"""Admin endpoints for the backup system.

Mounted at ``/api/v1/admin/backups``. All routes require an admin user
(see ``get_current_admin_user``). The filesystem under
``settings.BACKUP_DIR`` is the source of truth — no DB table.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Path as PathParam, status
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.api.deps import get_current_admin_user
from app.models.user import User
from app.services import backup_service
from app.services.backup_service import (
    BackupFileSet,
    BackupInProgressError,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/backups", tags=["admin", "backups"])


# Timestamps are always YYYYMMDD_HHMMSS — bound the path param to that
# shape so callers can't traverse the filesystem.
_TS_PATTERN = r"^\d{8}_\d{6}$"

BackupFileKind = Literal["db", "uploads", "rasters"]


class BackupRecord(BaseModel):
    """Wire-format projection of ``BackupFileSet``."""

    timestamp: str
    status: str
    source: str
    created_at: str
    total_size_bytes: int
    has_db: bool
    has_uploads: bool
    has_rasters: bool
    error_message: str | None = None
    triggered_by: str | None = None


def _to_record(b: BackupFileSet) -> BackupRecord:
    return BackupRecord(
        timestamp=b.timestamp,
        status=b.status,
        source=b.source,
        created_at=b.created_at.isoformat(),
        total_size_bytes=b.total_size_bytes,
        has_db=b.db_file is not None,
        has_uploads=b.uploads_file is not None,
        has_rasters=b.rasters_file is not None,
        error_message=b.error_message,
        triggered_by=b.triggered_by,
    )


@router.get("/", response_model=list[BackupRecord])
async def list_backups_endpoint(
    _: User = Depends(get_current_admin_user),
) -> list[BackupRecord]:
    backups = await backup_service.list_backups()
    return [_to_record(b) for b in backups]


@router.post(
    "/",
    response_model=BackupRecord,
    status_code=status.HTTP_202_ACCEPTED,
)
async def trigger_backup_endpoint(
    current_user: User = Depends(get_current_admin_user),
) -> BackupRecord:
    """Kick off a manual backup.

    Returns 202 immediately with a placeholder record while the backup
    runs in the background. The frontend polls
    ``GET /admin/backups/{timestamp}`` until ``status='completed'``.
    """
    # Pre-flight check so we surface a clean 409 instead of starting a
    # task that would raise as soon as it starts.
    if await asyncio.to_thread(
        backup_service._existing_in_progress, backup_service._backup_dir()
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Another backup is already in progress.",
        )

    triggered_by = current_user.email

    async def _runner() -> None:
        try:
            await backup_service.run_backup(source="manual", triggered_by=triggered_by)
        except BackupInProgressError:
            # Race with another caller; safe to ignore — the other run
            # will produce the artifacts.
            logger.info("Manual backup skipped — another run beat us to it")
        except Exception:  # pragma: no cover - defensive
            # ``run_backup`` itself converts internal failures into a
            # ``failed`` marker and returns, so we should rarely land
            # here. Log and swallow to keep the orphan task quiet.
            logger.exception("Background backup task crashed unexpectedly")

    asyncio.create_task(_runner())

    # Wait briefly for the runner to write the in-progress marker so the
    # initial response carries a real timestamp/status. We poll instead
    # of awaiting the task itself — we want the request to return fast
    # for the user.
    for _ in range(20):
        await asyncio.sleep(0.05)
        latest = await backup_service.list_backups()
        if latest and latest[0].status == "in_progress":
            return _to_record(latest[0])

    # Couldn't observe a marker; fall back to a synthetic in-progress
    # record so the UI has something to poll on.
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Backup task started but did not register an in-progress marker.",
    )


@router.get("/{timestamp}", response_model=BackupRecord)
async def get_backup_endpoint(
    timestamp: str = PathParam(..., pattern=_TS_PATTERN),
    _: User = Depends(get_current_admin_user),
) -> BackupRecord:
    record = await backup_service.get_backup(timestamp)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Backup not found",
        )
    return _to_record(record)


@router.get("/{timestamp}/files/{kind}")
async def download_backup_file_endpoint(
    timestamp: str = PathParam(..., pattern=_TS_PATTERN),
    kind: BackupFileKind = PathParam(...),
    _: User = Depends(get_current_admin_user),
) -> FileResponse:
    record = await backup_service.get_backup(timestamp)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Backup not found",
        )

    file_path = {
        "db": record.db_file,
        "uploads": record.uploads_file,
        "rasters": record.rasters_file,
    }[kind]

    if file_path is None or not file_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Backup has no {kind} file",
        )

    return FileResponse(
        path=file_path,
        filename=file_path.name,
        media_type="application/gzip",
    )


@router.delete("/{timestamp}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_backup_endpoint(
    timestamp: str = PathParam(..., pattern=_TS_PATTERN),
    _: User = Depends(get_current_admin_user),
):
    record = await backup_service.get_backup(timestamp)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Backup not found",
        )
    if record.status == "in_progress":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete a backup that is still in progress.",
        )
    await backup_service.delete_backup(timestamp)
