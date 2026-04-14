"""Tests for multi-dataset bundle upload endpoints."""

from __future__ import annotations

import io
import json
import zipfile
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient


def _zip_bytes(entries: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in entries.items():
            zf.writestr(name, data)
    return buf.getvalue()


class TestInspectEndpoint:
    @pytest.mark.asyncio
    async def test_rejects_non_zip(self, client: AsyncClient, admin_auth_headers: dict):
        resp = await client.post(
            "/api/v1/upload/inspect",
            files={"file": ("x.shp", io.BytesIO(b"not a zip"), "application/octet-stream")},
            headers=admin_auth_headers,
        )
        assert resp.status_code == 400
        assert "zip" in resp.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_detects_multiple_datasets(
        self, client: AsyncClient, admin_auth_headers: dict
    ):
        zip_data = _zip_bytes(
            {
                "a.shp": b"s",
                "a.shx": b"s",
                "a.dbf": b"s",
                "a.prj": b"p",
                "b.tif": b"t",
            }
        )
        resp = await client.post(
            "/api/v1/upload/inspect",
            files={"file": ("bundle.zip", io.BytesIO(zip_data), "application/zip")},
            headers=admin_auth_headers,
        )
        assert resp.status_code == 200
        datasets = resp.json()["datasets"]
        assert len(datasets) == 2
        primary_files = {d["primary_file"] for d in datasets}
        assert primary_files == {"a.shp", "b.tif"}

    @pytest.mark.asyncio
    async def test_requires_auth(self, client: AsyncClient):
        resp = await client.post(
            "/api/v1/upload/inspect",
            files={"file": ("x.zip", io.BytesIO(b"PK"), "application/zip")},
        )
        assert resp.status_code in (401, 403)


class TestBundleUploadEndpoint:
    @pytest.mark.asyncio
    async def test_rejects_non_zip(self, client: AsyncClient, admin_auth_headers: dict):
        resp = await client.post(
            "/api/v1/upload/bundle",
            files={"file": ("x.shp", io.BytesIO(b"x"), "application/octet-stream")},
            data={"datasets": "[]", "category": "reference"},
            headers=admin_auth_headers,
        )
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_rejects_invalid_datasets_json(
        self, client: AsyncClient, admin_auth_headers: dict
    ):
        zip_data = _zip_bytes({"a.shp": b"s", "a.shx": b"s", "a.dbf": b"s"})
        resp = await client.post(
            "/api/v1/upload/bundle",
            files={"file": ("b.zip", io.BytesIO(zip_data), "application/zip")},
            data={"datasets": "not-json", "category": "reference"},
            headers=admin_auth_headers,
        )
        assert resp.status_code == 400
        assert "datasets" in resp.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_rejects_empty_included(
        self, client: AsyncClient, admin_auth_headers: dict
    ):
        zip_data = _zip_bytes({"a.shp": b"s", "a.shx": b"s", "a.dbf": b"s"})
        meta = [
            {"primary_file": "a.shp", "name": "A", "include": False}
        ]
        resp = await client.post(
            "/api/v1/upload/bundle",
            files={"file": ("b.zip", io.BytesIO(zip_data), "application/zip")},
            data={"datasets": json.dumps(meta), "category": "reference"},
            headers=admin_auth_headers,
        )
        assert resp.status_code == 400
        assert "included" in resp.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_creates_jobs_for_included_datasets(
        self, client: AsyncClient, admin_auth_headers: dict
    ):
        zip_data = _zip_bytes(
            {
                "a.shp": b"s",
                "a.shx": b"s",
                "a.dbf": b"s",
                "a.prj": b"p",
                "b.tif": b"t",
            }
        )
        meta = [
            {"primary_file": "a.shp", "name": "Dataset A", "include": True},
            {"primary_file": "b.tif", "name": "Dataset B", "include": True},
        ]
        # Stub out the actual background processing so tests don't need
        # full geopandas/rasterio stacks on this file content.
        with patch(
            "app.services.file_processor.file_processor.process_vector_background",
            new=AsyncMock(return_value=None),
        ), patch(
            "app.services.file_processor.file_processor.process_raster_background",
            new=AsyncMock(return_value=None),
        ):
            resp = await client.post(
                "/api/v1/upload/bundle",
                files={"file": ("b.zip", io.BytesIO(zip_data), "application/zip")},
                data={"datasets": json.dumps(meta), "category": "reference"},
                headers=admin_auth_headers,
            )
        assert resp.status_code == 202, resp.text
        body = resp.json()
        assert "bundle_id" in body
        assert len(body["jobs"]) == 2
        bundle_ids = {j["bundle_id"] for j in body["jobs"]}
        assert bundle_ids == {body["bundle_id"]}
        assert all(j["status"] == "pending" for j in body["jobs"])

    @pytest.mark.asyncio
    async def test_skips_excluded_datasets(
        self, client: AsyncClient, admin_auth_headers: dict
    ):
        zip_data = _zip_bytes(
            {
                "a.shp": b"s", "a.shx": b"s", "a.dbf": b"s", "a.prj": b"p",
                "b.shp": b"s", "b.shx": b"s", "b.dbf": b"s", "b.prj": b"p",
            }
        )
        meta = [
            {"primary_file": "a.shp", "name": "A", "include": True},
            {"primary_file": "b.shp", "name": "B", "include": False},
        ]
        with patch(
            "app.services.file_processor.file_processor.process_vector_background",
            new=AsyncMock(return_value=None),
        ):
            resp = await client.post(
                "/api/v1/upload/bundle",
                files={"file": ("b.zip", io.BytesIO(zip_data), "application/zip")},
                data={"datasets": json.dumps(meta), "category": "reference"},
                headers=admin_auth_headers,
            )
        assert resp.status_code == 202
        assert len(resp.json()["jobs"]) == 1

    @pytest.mark.asyncio
    async def test_skips_client_requested_files_not_in_zip(
        self, client: AsyncClient, admin_auth_headers: dict
    ):
        zip_data = _zip_bytes({"a.shp": b"s", "a.shx": b"s", "a.dbf": b"s", "a.prj": b"p"})
        meta = [
            {"primary_file": "a.shp", "name": "A", "include": True},
            {"primary_file": "ghost.shp", "name": "Ghost", "include": True},
        ]
        with patch(
            "app.services.file_processor.file_processor.process_vector_background",
            new=AsyncMock(return_value=None),
        ):
            resp = await client.post(
                "/api/v1/upload/bundle",
                files={"file": ("b.zip", io.BytesIO(zip_data), "application/zip")},
                data={"datasets": json.dumps(meta), "category": "reference"},
                headers=admin_auth_headers,
            )
        assert resp.status_code == 202
        assert len(resp.json()["jobs"]) == 1
