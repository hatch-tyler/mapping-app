"""Backup orchestration: pg_dump + uploads/rasters tarballs.

The filesystem under ``settings.BACKUP_DIR`` is the source of truth for
backup history. Each backup writes up to three timestamped files plus a
small JSON marker that tracks status and provenance:

* ``db_<ts>.sql.gz`` — Postgres pg_dump output, gzip-compressed.
* ``uploads_<ts>.tar.gz`` — tarball of ``/app/data/uploads/``. Skipped when empty.
* ``rasters_<ts>.tar.gz`` — tarball of ``/app/data/rasters/``. Skipped when empty.
* ``.in_progress_<ts>`` — written first; replaced with ``.completed_<ts>`` or
  ``.failed_<ts>`` when the run terminates. The marker doubles as a
  single-flight lock — overlapping runs raise ``BackupInProgressError``.

The shape lets the API list backups by scanning the directory; no DB
table is needed. A backend restart mid-backup leaves the on-disk state
consistent (the marker shows the run was in progress; ``list_backups``
classifies it as ``failed`` once stale).

Implementation notes:

* Long-running blocking work (pg_dump, tar) goes through
  ``asyncio.create_subprocess_exec`` so the event loop stays responsive.
* pg_dump credentials are pulled from ``settings.DATABASE_URL`` via
  ``sqlalchemy.engine.url.make_url`` and passed via the standard
  PostgreSQL environment variables (``PGHOST``/``PGUSER``/``PGPASSWORD``/etc).
"""

from __future__ import annotations

import asyncio
import gzip
import json
import logging
import os
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal

from sqlalchemy.engine.url import make_url

from app.config import settings
from app.services.blob_backup import BlobBackupClient, blob_names_for_timestamp

logger = logging.getLogger(__name__)


_TIMESTAMP_RE = re.compile(r"(\d{8}_\d{6})")
_STALE_IN_PROGRESS_THRESHOLD = timedelta(hours=2)
"""An ``.in_progress_*`` marker older than this is considered crashed.

pg_dump on a many-GB DB plus tarring uploads/rasters can legitimately
take a long time on a constrained VM, so we stay generous (2 h) before
declaring an in-progress run dead.
"""


BackupStatus = Literal["in_progress", "completed", "failed", "partial"]
BackupSource = Literal["manual", "scheduled", "unknown"]


class BackupInProgressError(RuntimeError):
    """Raised when ``run_backup`` is called while another backup is running.

    The marker file under ``BACKUP_DIR`` is the single-flight lock.
    """


@dataclass(frozen=True)
class BackupFileSet:
    """One backup's on-disk presence and metadata.

    ``remote_replicated`` and ``remote_error`` describe the off-VM
    Azure Blob copy. They're independent of ``status`` — a backup can
    be ``completed`` locally but with ``remote_replicated=False`` if
    the blob upload failed (the local copy on the data disk is still
    good; only the off-VM safety net is missing). When blob
    replication is not configured at all, ``remote_replicated`` is
    ``False`` and ``remote_error`` is ``None``.
    """

    timestamp: str
    db_file: Path | None
    uploads_file: Path | None
    rasters_file: Path | None
    total_size_bytes: int
    created_at: datetime
    status: BackupStatus
    source: BackupSource
    error_message: str | None = None
    triggered_by: str | None = None
    remote_replicated: bool = False
    remote_error: str | None = None


def _ts_now() -> str:
    """Stable timestamp suffix used in filenames (UTC, no separators)."""
    return datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")


def _parse_ts(ts: str) -> datetime:
    return datetime.strptime(ts, "%Y%m%d_%H%M%S").replace(tzinfo=timezone.utc)


def _backup_dir() -> Path:
    """Return the configured backup directory, creating it if missing."""
    d = Path(settings.BACKUP_DIR)
    d.mkdir(parents=True, exist_ok=True)
    return d


def _marker_paths(d: Path, ts: str) -> dict[str, Path]:
    return {
        "in_progress": d / f".in_progress_{ts}",
        "completed": d / f".completed_{ts}",
        "failed": d / f".failed_{ts}",
    }


def _backup_paths(d: Path, ts: str) -> dict[str, Path]:
    return {
        "db": d / f"db_{ts}.sql.gz",
        "uploads": d / f"uploads_{ts}.tar.gz",
        "rasters": d / f"rasters_{ts}.tar.gz",
    }


def _existing_in_progress(d: Path) -> Path | None:
    """Return the youngest non-stale ``.in_progress_*`` marker, if any.

    Stale markers (older than ``_STALE_IN_PROGRESS_THRESHOLD``) are
    treated as crashed runs and ignored — they'll be surfaced as
    ``failed`` by ``list_backups``.
    """
    candidates = sorted(
        d.glob(".in_progress_*"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    now = datetime.now(timezone.utc).timestamp()
    for p in candidates:
        if now - p.stat().st_mtime < _STALE_IN_PROGRESS_THRESHOLD.total_seconds():
            return p
    return None


def _read_marker(p: Path) -> dict:
    """Parse a marker file as JSON; return empty dict on any error.

    Markers are best-effort metadata; if the file is malformed the
    backup record still surfaces with the right status (the marker's
    presence is what matters), just without provenance details.
    """
    try:
        return json.loads(p.read_text())
    except Exception:
        return {}


def _safe_size(p: Path) -> int:
    try:
        return p.stat().st_size
    except FileNotFoundError:
        return 0


def _build_record(d: Path, ts: str) -> BackupFileSet:
    """Inspect on-disk state for a single timestamp, return a record."""
    files = _backup_paths(d, ts)
    markers = _marker_paths(d, ts)

    db = files["db"] if files["db"].exists() else None
    uploads = files["uploads"] if files["uploads"].exists() else None
    rasters = files["rasters"] if files["rasters"].exists() else None
    total = sum(_safe_size(p) for p in (db, uploads, rasters) if p is not None)

    if markers["in_progress"].exists():
        marker = markers["in_progress"]
        meta = _read_marker(marker)
        # Stale in-progress (older than threshold) → failed.
        age = datetime.now(timezone.utc).timestamp() - marker.stat().st_mtime
        if age >= _STALE_IN_PROGRESS_THRESHOLD.total_seconds():
            status: BackupStatus = "failed"
            error = "backup did not complete (worker crashed or restarted)"
        else:
            status = "in_progress"
            error = None
    elif markers["failed"].exists():
        meta = _read_marker(markers["failed"])
        status = "failed"
        error = meta.get("error")
    elif markers["completed"].exists():
        meta = _read_marker(markers["completed"])
        # If the completion marker exists but the DB file is missing, the
        # files were partially deleted — surface as "partial".
        status = "completed" if db is not None else "partial"
        error = None
    else:
        # Files exist with no marker (legacy or hand-placed).
        meta = {}
        status = "completed" if db is not None else "partial"
        error = None

    return BackupFileSet(
        timestamp=ts,
        db_file=db,
        uploads_file=uploads,
        rasters_file=rasters,
        total_size_bytes=total,
        created_at=_parse_ts(ts),
        status=status,
        source=meta.get("source", "unknown"),
        error_message=error,
        triggered_by=meta.get("triggered_by"),
        remote_replicated=bool(meta.get("remote_replicated", False)),
        remote_error=meta.get("remote_error"),
    )


def _scan_backup_timestamps(d: Path) -> list[str]:
    """Collect every timestamp referenced by a file or marker in ``d``."""
    seen: set[str] = set()
    for p in d.iterdir():
        m = _TIMESTAMP_RE.search(p.name)
        if m:
            seen.add(m.group(1))
    return sorted(seen, reverse=True)


async def list_backups() -> list[BackupFileSet]:
    """Return all backups in BACKUP_DIR, newest first."""
    return await asyncio.to_thread(_list_backups_sync)


def _list_backups_sync() -> list[BackupFileSet]:
    d = _backup_dir()
    return [_build_record(d, ts) for ts in _scan_backup_timestamps(d)]


async def get_backup(timestamp: str) -> BackupFileSet | None:
    return await asyncio.to_thread(_get_backup_sync, timestamp)


def _get_backup_sync(timestamp: str) -> BackupFileSet | None:
    d = _backup_dir()
    if timestamp not in _scan_backup_timestamps(d):
        return None
    return _build_record(d, timestamp)


async def delete_backup(timestamp: str) -> None:
    """Remove every file (data + markers) for one backup timestamp."""
    await asyncio.to_thread(_delete_backup_sync, timestamp)


def _delete_backup_sync(timestamp: str) -> None:
    d = _backup_dir()
    targets = [
        *_backup_paths(d, timestamp).values(),
        *_marker_paths(d, timestamp).values(),
    ]
    for p in targets:
        try:
            p.unlink(missing_ok=True)
        except OSError:
            logger.exception("Failed to remove backup file %s", p)

    # Off-VM blob copies (if any) — best-effort. A failure here just
    # leaves orphan blobs that the user can sweep up later; it must
    # not block deletion of the local files.
    client = BlobBackupClient.from_settings()
    if client is not None:
        for blob_name in blob_names_for_timestamp(timestamp):
            try:
                client.delete(blob_name)
            except Exception:
                logger.warning(
                    "Failed to delete blob %s during prune of %s",
                    blob_name,
                    timestamp,
                    exc_info=True,
                )


async def prune_old_backups(retention_days: int | None = None) -> int:
    """Delete backups older than the retention window. Returns count removed."""
    days = (
        retention_days if retention_days is not None else settings.BACKUP_RETENTION_DAYS
    )
    return await asyncio.to_thread(_prune_old_backups_sync, days)


def _prune_old_backups_sync(retention_days: int) -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    d = _backup_dir()
    removed = 0
    for ts in _scan_backup_timestamps(d):
        try:
            ts_dt = _parse_ts(ts)
        except ValueError:
            continue
        if ts_dt < cutoff:
            _delete_backup_sync(ts)
            removed += 1
    return removed


def _pg_dump_env() -> dict[str, str]:
    """Build the env block (PGHOST/PGUSER/etc.) for invoking pg_dump.

    Sourced from ``settings.DATABASE_URL``. The asyncpg driver name in
    the URL is dropped — pg_dump uses the libpq protocol.
    """
    url = make_url(settings.DATABASE_URL)
    env = os.environ.copy()
    if url.host:
        env["PGHOST"] = url.host
    if url.port:
        env["PGPORT"] = str(url.port)
    if url.username:
        env["PGUSER"] = url.username
    if url.password:
        env["PGPASSWORD"] = url.password
    if url.database:
        env["PGDATABASE"] = url.database
    return env


async def _run_pg_dump(out_file: Path) -> None:
    """Stream pg_dump output through gzip into ``out_file``.

    pg_dump runs as an async subprocess; its stdout is read in chunks and
    fed through ``gzip.GzipFile`` in-process. Doing the gzip step in
    Python (rather than as a second subprocess) avoids the asyncio
    pipe-wiring pitfalls of ``stdout=… | stdin=…`` between two
    ``create_subprocess_exec`` processes, while still streaming —
    GzipFile compresses incrementally, so peak memory is bounded by the
    chunk size, not the dump size.
    """
    out_file.parent.mkdir(parents=True, exist_ok=True)
    env = _pg_dump_env()
    db_name = env.get("PGDATABASE")
    if not db_name:
        raise RuntimeError("PGDATABASE not set; cannot run pg_dump")

    proc = await asyncio.create_subprocess_exec(
        "pg_dump",
        "--no-owner",
        "--no-acl",
        db_name,
        env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    assert proc.stdout is not None

    chunk_size = 64 * 1024
    with gzip.open(out_file, "wb") as gz:
        while True:
            chunk = await proc.stdout.read(chunk_size)
            if not chunk:
                break
            gz.write(chunk)

    rc = await proc.wait()
    if rc != 0:
        err = (
            (await proc.stderr.read()).decode("utf-8", "replace") if proc.stderr else ""
        )
        raise RuntimeError(f"pg_dump exited {rc}: {err.strip()[:1000]}")


async def _tar_dir(source_dir: Path, out_file: Path) -> bool:
    """Write a gzipped tar of ``source_dir`` into ``out_file``.

    Returns True if the archive was written, False if ``source_dir`` is
    missing or empty (the empty case is a normal "nothing to back up").
    """
    if not source_dir.exists():
        return False
    if not any(source_dir.iterdir()):
        return False

    out_file.parent.mkdir(parents=True, exist_ok=True)
    proc = await asyncio.create_subprocess_exec(
        "tar",
        "-czf",
        str(out_file),
        "-C",
        str(source_dir.parent),
        source_dir.name,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    rc = await proc.wait()
    if rc != 0:
        err = (
            (await proc.stderr.read()).decode("utf-8", "replace") if proc.stderr else ""
        )
        raise RuntimeError(f"tar exited {rc}: {err.strip()[:1000]}")
    return True


def _write_marker(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, default=str))


async def _replicate_to_blob(
    timestamp: str, artifacts: list[Path]
) -> tuple[bool, str | None]:
    """Upload a finished backup's artifacts to Azure Blob Storage.

    Returns ``(replicated, error)``:

    * ``(False, None)``  — replication is not configured; nothing to do.
    * ``(True, None)``   — every artifact uploaded successfully.
    * ``(False, "...")`` — replication is configured but at least one
      upload failed; the local copy is unaffected.

    The SDK is synchronous; the upload runs in a worker thread so the
    event loop stays responsive during multi-hundred-MB uploads.
    """
    client = await asyncio.to_thread(BlobBackupClient.from_settings)
    if client is None:
        return False, None

    try:
        for path in artifacts:
            await asyncio.to_thread(client.upload, path, path.name)
        return True, None
    except Exception as e:
        logger.exception("Blob replication failed for backup %s", timestamp)
        return False, f"{type(e).__name__}: {e}"[:1000]


async def run_backup(
    *,
    source: BackupSource = "manual",
    triggered_by: str | None = None,
) -> BackupFileSet:
    """Create a full backup. Single-flight via the in-progress marker.

    Raises ``BackupInProgressError`` if another backup is currently
    running. On any internal failure the function still returns a
    ``BackupFileSet`` with ``status='failed'`` and ``error_message``
    populated, after writing the ``.failed_<ts>`` marker so the UI can
    surface the failure. Re-raises only programmer-level errors
    (interpreter exit, etc.).
    """
    d = _backup_dir()
    if _existing_in_progress(d):
        raise BackupInProgressError("Another backup is currently in progress.")

    ts = _ts_now()
    paths = _backup_paths(d, ts)
    markers = _marker_paths(d, ts)

    started_at = datetime.now(timezone.utc)
    in_progress_payload = {
        "source": source,
        "triggered_by": triggered_by,
        "started_at": started_at.isoformat(),
    }
    _write_marker(markers["in_progress"], in_progress_payload)

    try:
        await _run_pg_dump(paths["db"])
        uploads_written = await _tar_dir(Path(settings.UPLOAD_DIR), paths["uploads"])
        rasters_written = await _tar_dir(Path(settings.RASTER_DIR), paths["rasters"])

        db_size = _safe_size(paths["db"])
        uploads_size = _safe_size(paths["uploads"]) if uploads_written else 0
        rasters_size = _safe_size(paths["rasters"]) if rasters_written else 0

        # Replicate to Azure Blob (best-effort — see ``blob_backup``).
        # Local artifacts are already on the persistent data disk; if
        # the off-VM copy fails we record the error but keep the
        # backup as ``completed``.
        artifacts_to_replicate: list[Path] = [paths["db"]]
        if uploads_written:
            artifacts_to_replicate.append(paths["uploads"])
        if rasters_written:
            artifacts_to_replicate.append(paths["rasters"])
        remote_replicated, remote_error = await _replicate_to_blob(
            ts, artifacts_to_replicate
        )

        ended_at = datetime.now(timezone.utc)
        completed_payload = {
            **in_progress_payload,
            "ended_at": ended_at.isoformat(),
            "db_size_bytes": db_size,
            "uploads_size_bytes": uploads_size,
            "rasters_size_bytes": rasters_size,
            "remote_replicated": remote_replicated,
            "remote_error": remote_error,
        }
        _write_marker(markers["completed"], completed_payload)
        markers["in_progress"].unlink(missing_ok=True)
        logger.info(
            "Backup %s completed (source=%s, size=%d bytes, remote=%s)",
            ts,
            source,
            db_size + uploads_size + rasters_size,
            "yes" if remote_replicated else ("error" if remote_error else "off"),
        )
        return _build_record(d, ts)

    except Exception as e:
        logger.exception("Backup %s failed", ts)
        failed_payload = {
            **in_progress_payload,
            "error": f"{type(e).__name__}: {e}"[:1000],
            "ended_at": datetime.now(timezone.utc).isoformat(),
        }
        try:
            _write_marker(markers["failed"], failed_payload)
            markers["in_progress"].unlink(missing_ok=True)
        except Exception:
            logger.exception("Failed to write failure marker for %s", ts)
        return _build_record(d, ts)
