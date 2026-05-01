"""Tests for app.services.backup_service."""

from __future__ import annotations

import asyncio
import gzip
import json
import os
import tarfile
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import pytest

from app.services import backup_service
from app.services.backup_service import (
    BackupInProgressError,
    delete_backup,
    get_backup,
    list_backups,
    prune_old_backups,
    run_backup,
)


@pytest.fixture
def backup_dirs(monkeypatch):
    """Create isolated dirs for backups, uploads, rasters per test."""
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        backup_dir = root / "backups"
        upload_dir = root / "uploads"
        raster_dir = root / "rasters"
        for d in (backup_dir, upload_dir, raster_dir):
            d.mkdir(parents=True, exist_ok=True)

        monkeypatch.setattr(backup_service.settings, "BACKUP_DIR", str(backup_dir))
        monkeypatch.setattr(backup_service.settings, "UPLOAD_DIR", str(upload_dir))
        monkeypatch.setattr(backup_service.settings, "RASTER_DIR", str(raster_dir))
        monkeypatch.setattr(backup_service.settings, "BACKUP_RETENTION_DAYS", 30)

        yield {
            "backup": backup_dir,
            "uploads": upload_dir,
            "rasters": raster_dir,
        }


async def _fake_pg_dump(out_file: Path) -> None:
    """Stand-in for pg_dump that writes a tiny gzipped SQL placeholder."""
    out_file.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(out_file, "wb") as f:
        f.write(b"-- fake pg_dump output\nSELECT 1;\n")


@pytest.mark.asyncio
async def test_run_backup_creates_three_files(backup_dirs, monkeypatch):
    """Happy path: db + uploads + rasters all written, marker is .completed."""
    (backup_dirs["uploads"] / "a.txt").write_text("hello")
    (backup_dirs["rasters"] / "r.tif").write_bytes(b"\x00\x01")

    with patch.object(backup_service, "_run_pg_dump", side_effect=_fake_pg_dump):
        result = await run_backup(source="manual", triggered_by="t@example.com")

    assert result.status == "completed"
    assert result.db_file is not None and result.db_file.exists()
    assert result.uploads_file is not None and result.uploads_file.exists()
    assert result.rasters_file is not None and result.rasters_file.exists()
    assert result.source == "manual"
    assert result.triggered_by == "t@example.com"

    # in_progress marker is replaced by completed
    files = {p.name for p in backup_dirs["backup"].iterdir()}
    assert any(n.startswith(".completed_") for n in files)
    assert not any(n.startswith(".in_progress_") for n in files)


@pytest.mark.asyncio
async def test_run_backup_skips_empty_uploads(backup_dirs):
    """Empty uploads/rasters dirs → no tarball, status still completed."""
    with patch.object(backup_service, "_run_pg_dump", side_effect=_fake_pg_dump):
        result = await run_backup(source="scheduled")

    assert result.status == "completed"
    assert result.db_file is not None
    assert result.uploads_file is None
    assert result.rasters_file is None


@pytest.mark.asyncio
async def test_list_backups_groups_by_timestamp(backup_dirs):
    """Two backups → two records, newest first."""

    async def _dump(out_file: Path) -> None:
        await _fake_pg_dump(out_file)

    with patch.object(backup_service, "_run_pg_dump", side_effect=_dump):
        first = await run_backup(source="manual")
        # Different second-resolution timestamp
        await asyncio.sleep(1.1)
        second = await run_backup(source="scheduled")

    records = await list_backups()
    assert len(records) == 2
    # newest first
    assert records[0].timestamp == second.timestamp
    assert records[1].timestamp == first.timestamp


@pytest.mark.asyncio
async def test_in_progress_marker_surfaces(backup_dirs):
    """A bare in-progress marker shows up as status=in_progress."""
    d = backup_dirs["backup"]
    ts = "20260101_120000"
    marker = d / f".in_progress_{ts}"
    # Use os.utime to keep the marker fresh (under stale threshold).
    marker.write_text(json.dumps({"source": "manual", "started_at": "x"}))

    records = await list_backups()
    assert len(records) == 1
    assert records[0].timestamp == ts
    assert records[0].status == "in_progress"


@pytest.mark.asyncio
async def test_stale_in_progress_marker_becomes_failed(backup_dirs):
    """Old in-progress markers (past 2h) classify as failed."""
    d = backup_dirs["backup"]
    ts = "20260101_120000"
    marker = d / f".in_progress_{ts}"
    marker.write_text(json.dumps({"source": "manual"}))

    # Backdate the file mtime well beyond the stale threshold.
    old = (datetime.now(timezone.utc) - timedelta(hours=6)).timestamp()
    os.utime(marker, (old, old))

    records = await list_backups()
    assert len(records) == 1
    assert records[0].status == "failed"


@pytest.mark.asyncio
async def test_run_backup_409_when_in_progress(backup_dirs):
    """A fresh in-progress marker blocks new runs."""
    d = backup_dirs["backup"]
    ts = "20260101_120000"
    (d / f".in_progress_{ts}").write_text(json.dumps({"source": "manual"}))

    with pytest.raises(BackupInProgressError):
        await run_backup(source="manual")


@pytest.mark.asyncio
async def test_run_backup_failure_writes_failed_marker(backup_dirs):
    """When pg_dump errors, status=failed + .failed_<ts> marker exists."""

    async def _boom(out_file: Path) -> None:
        raise RuntimeError("synthetic pg_dump failure")

    with patch.object(backup_service, "_run_pg_dump", side_effect=_boom):
        result = await run_backup(source="manual")

    assert result.status == "failed"
    assert result.error_message and "synthetic pg_dump failure" in result.error_message
    files = {p.name for p in backup_dirs["backup"].iterdir()}
    assert any(n.startswith(".failed_") for n in files)
    assert not any(n.startswith(".in_progress_") for n in files)


@pytest.mark.asyncio
async def test_prune_old_backups_respects_retention(backup_dirs):
    """Backups older than retention_days disappear; recent ones stay."""
    d = backup_dirs["backup"]

    # Old backup (60 days back, within YYYYMMDD_HHMMSS shape).
    old_ts = (datetime.now(timezone.utc) - timedelta(days=60)).strftime("%Y%m%d_%H%M%S")
    (d / f"db_{old_ts}.sql.gz").write_bytes(b"\x1f\x8b old")
    (d / f".completed_{old_ts}").write_text(json.dumps({"source": "manual"}))

    # Recent backup (today).
    new_ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    (d / f"db_{new_ts}.sql.gz").write_bytes(b"\x1f\x8b new")
    (d / f".completed_{new_ts}").write_text(json.dumps({"source": "manual"}))

    removed = await prune_old_backups(retention_days=30)
    assert removed == 1

    remaining = await list_backups()
    assert {r.timestamp for r in remaining} == {new_ts}


@pytest.mark.asyncio
async def test_delete_backup_removes_all_files(backup_dirs):
    """delete_backup cleans up data + marker files for a timestamp."""
    d = backup_dirs["backup"]
    ts = "20260202_010203"
    (d / f"db_{ts}.sql.gz").write_bytes(b"x")
    (d / f"uploads_{ts}.tar.gz").write_bytes(b"y")
    (d / f"rasters_{ts}.tar.gz").write_bytes(b"z")
    (d / f".completed_{ts}").write_text(json.dumps({}))

    await delete_backup(ts)

    assert list(d.iterdir()) == []


@pytest.mark.asyncio
async def test_get_backup_unknown_returns_none(backup_dirs):
    assert await get_backup("19990101_000000") is None


@pytest.mark.asyncio
async def test_tar_dir_writes_archive(backup_dirs):
    """_tar_dir produces a real tarball when source has files."""
    src = backup_dirs["uploads"]
    (src / "a.txt").write_text("alpha")
    (src / "b.txt").write_text("beta")
    out = backup_dirs["backup"] / "uploads_test.tar.gz"

    wrote = await backup_service._tar_dir(src, out)
    assert wrote is True
    assert out.exists()

    with tarfile.open(out, "r:gz") as tf:
        names = sorted(tf.getnames())
    # Expect entries scoped under the directory's basename.
    assert any(n.endswith("a.txt") for n in names)
    assert any(n.endswith("b.txt") for n in names)


@pytest.mark.asyncio
async def test_tar_dir_returns_false_for_empty(backup_dirs):
    out = backup_dirs["backup"] / "uploads_empty.tar.gz"
    wrote = await backup_service._tar_dir(backup_dirs["uploads"], out)
    assert wrote is False
    assert not out.exists()
