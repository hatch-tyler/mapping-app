"""Tests for the admin backup API endpoints."""

from __future__ import annotations

import asyncio
import gzip
import json
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest
from httpx import AsyncClient

from app.services import backup_service


@pytest.fixture
def backup_dirs(monkeypatch):
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


def _write_completed_backup(d: Path, ts: str, *, source: str = "manual") -> None:
    """Lay down on-disk artifacts for a completed backup."""
    db_path = d / f"db_{ts}.sql.gz"
    with gzip.open(db_path, "wb") as f:
        f.write(b"-- fake dump\n")
    (d / f".completed_{ts}").write_text(
        json.dumps({"source": source, "triggered_by": "x@example.com"})
    )


class TestListBackups:
    @pytest.mark.asyncio
    async def test_admin_can_list_empty(
        self, client: AsyncClient, admin_auth_headers: dict, backup_dirs
    ):
        r = await client.get("/api/v1/admin/backups/", headers=admin_auth_headers)
        assert r.status_code == 200
        assert r.json() == []

    @pytest.mark.asyncio
    async def test_admin_can_list_records(
        self, client: AsyncClient, admin_auth_headers: dict, backup_dirs
    ):
        _write_completed_backup(backup_dirs["backup"], "20260301_010101")
        r = await client.get("/api/v1/admin/backups/", headers=admin_auth_headers)
        assert r.status_code == 200
        body = r.json()
        assert len(body) == 1
        assert body[0]["timestamp"] == "20260301_010101"
        assert body[0]["status"] == "completed"
        assert body[0]["has_db"] is True
        assert body[0]["has_uploads"] is False

    @pytest.mark.asyncio
    async def test_non_admin_denied(
        self, client: AsyncClient, auth_headers: dict, backup_dirs
    ):
        r = await client.get("/api/v1/admin/backups/", headers=auth_headers)
        assert r.status_code == 403

    @pytest.mark.asyncio
    async def test_unauthenticated_denied(self, client: AsyncClient, backup_dirs):
        r = await client.get("/api/v1/admin/backups/")
        assert r.status_code in (401, 403)


class TestTriggerBackup:
    @pytest.mark.asyncio
    async def test_post_starts_backup(
        self, client: AsyncClient, admin_auth_headers: dict, backup_dirs
    ):
        # Block the runner inside run_backup so the in_progress marker is
        # observable when the endpoint returns.
        gate = asyncio.Event()

        async def _slow_dump(out_file: Path) -> None:
            out_file.parent.mkdir(parents=True, exist_ok=True)
            with gzip.open(out_file, "wb") as f:
                f.write(b"-- fake\n")
            await gate.wait()

        with patch.object(backup_service, "_run_pg_dump", side_effect=_slow_dump):
            r = await client.post("/api/v1/admin/backups/", headers=admin_auth_headers)
            assert r.status_code == 202
            body = r.json()
            assert body["status"] == "in_progress"
            assert body["source"] == "manual"
            assert body["triggered_by"] == "admin@example.com"
            gate.set()
            # Drain pending background task before fixture teardown.
            for _ in range(50):
                await asyncio.sleep(0.02)
                latest = await backup_service.list_backups()
                if latest and latest[0].status == "completed":
                    break

    @pytest.mark.asyncio
    async def test_post_returns_409_when_in_progress(
        self, client: AsyncClient, admin_auth_headers: dict, backup_dirs
    ):
        ts = "20260301_010101"
        (backup_dirs["backup"] / f".in_progress_{ts}").write_text(
            json.dumps({"source": "manual"})
        )
        r = await client.post("/api/v1/admin/backups/", headers=admin_auth_headers)
        assert r.status_code == 409

    @pytest.mark.asyncio
    async def test_non_admin_cannot_trigger(
        self, client: AsyncClient, auth_headers: dict, backup_dirs
    ):
        r = await client.post("/api/v1/admin/backups/", headers=auth_headers)
        assert r.status_code == 403


class TestGetBackup:
    @pytest.mark.asyncio
    async def test_get_single(
        self, client: AsyncClient, admin_auth_headers: dict, backup_dirs
    ):
        ts = "20260301_010101"
        _write_completed_backup(backup_dirs["backup"], ts)
        r = await client.get(f"/api/v1/admin/backups/{ts}", headers=admin_auth_headers)
        assert r.status_code == 200
        assert r.json()["timestamp"] == ts

    @pytest.mark.asyncio
    async def test_404_unknown_timestamp(
        self, client: AsyncClient, admin_auth_headers: dict, backup_dirs
    ):
        r = await client.get(
            "/api/v1/admin/backups/19990101_000000", headers=admin_auth_headers
        )
        assert r.status_code == 404

    @pytest.mark.asyncio
    async def test_invalid_timestamp_rejected(
        self, client: AsyncClient, admin_auth_headers: dict, backup_dirs
    ):
        r = await client.get(
            "/api/v1/admin/backups/not-a-timestamp", headers=admin_auth_headers
        )
        # FastAPI rejects pattern mismatch with 422.
        assert r.status_code == 422


class TestDownload:
    @pytest.mark.asyncio
    async def test_download_streams_db(
        self, client: AsyncClient, admin_auth_headers: dict, backup_dirs
    ):
        ts = "20260301_010101"
        _write_completed_backup(backup_dirs["backup"], ts)
        r = await client.get(
            f"/api/v1/admin/backups/{ts}/files/db", headers=admin_auth_headers
        )
        assert r.status_code == 200
        # gzip magic number
        assert r.content.startswith(b"\x1f\x8b")

    @pytest.mark.asyncio
    async def test_download_404_when_kind_missing(
        self, client: AsyncClient, admin_auth_headers: dict, backup_dirs
    ):
        ts = "20260301_010101"
        _write_completed_backup(backup_dirs["backup"], ts)
        r = await client.get(
            f"/api/v1/admin/backups/{ts}/files/uploads",
            headers=admin_auth_headers,
        )
        assert r.status_code == 404

    @pytest.mark.asyncio
    async def test_download_invalid_kind(
        self, client: AsyncClient, admin_auth_headers: dict, backup_dirs
    ):
        ts = "20260301_010101"
        _write_completed_backup(backup_dirs["backup"], ts)
        r = await client.get(
            f"/api/v1/admin/backups/{ts}/files/bogus",
            headers=admin_auth_headers,
        )
        assert r.status_code == 422


class TestDelete:
    @pytest.mark.asyncio
    async def test_delete_removes_files(
        self, client: AsyncClient, admin_auth_headers: dict, backup_dirs
    ):
        ts = "20260301_010101"
        _write_completed_backup(backup_dirs["backup"], ts)
        r = await client.delete(
            f"/api/v1/admin/backups/{ts}", headers=admin_auth_headers
        )
        assert r.status_code == 204
        assert list(backup_dirs["backup"].iterdir()) == []

    @pytest.mark.asyncio
    async def test_cannot_delete_in_progress(
        self, client: AsyncClient, admin_auth_headers: dict, backup_dirs
    ):
        ts = "20260301_010101"
        (backup_dirs["backup"] / f".in_progress_{ts}").write_text(
            json.dumps({"source": "manual"})
        )
        r = await client.delete(
            f"/api/v1/admin/backups/{ts}", headers=admin_auth_headers
        )
        assert r.status_code == 409

    @pytest.mark.asyncio
    async def test_delete_404_unknown(
        self, client: AsyncClient, admin_auth_headers: dict, backup_dirs
    ):
        r = await client.delete(
            "/api/v1/admin/backups/19990101_000000",
            headers=admin_auth_headers,
        )
        assert r.status_code == 404
