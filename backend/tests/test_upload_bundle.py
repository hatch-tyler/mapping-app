"""Tests for multi-dataset bundle upload endpoints."""

from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient


def _zip_bytes(entries: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in entries.items():
            zf.writestr(name, data)
    return buf.getvalue()


def _make_sample_gdb_zip(tmp_path: Path) -> bytes:
    """Build a small .gdb.zip in tmp_path. Skips the test if GDAL isn't available."""
    pytest.importorskip("fiona")
    pytest.importorskip("geopandas")
    import fiona
    import geopandas as gpd
    from shapely.geometry import Point

    if "OpenFileGDB" not in fiona.supported_drivers:
        pytest.skip("OpenFileGDB driver not available")
    if "w" not in fiona.supported_drivers["OpenFileGDB"]:
        pytest.skip("OpenFileGDB driver is read-only on this build")

    gdb_path = tmp_path / "sample.gdb"
    gdf = gpd.GeoDataFrame(
        {"id": [1, 2]},
        geometry=[Point(-122.4, 37.8), Point(-122.3, 37.9)],
        crs="EPSG:4326",
    )
    gdf.to_file(str(gdb_path), driver="OpenFileGDB", layer="points")
    gdf.to_file(str(gdb_path), driver="OpenFileGDB", layer="more_points")

    zip_path = tmp_path / "sample.gdb.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        for p in gdb_path.rglob("*"):
            if p.is_file():
                zf.write(p, arcname=p.relative_to(gdb_path.parent).as_posix())
    return zip_path.read_bytes()


class TestInspectEndpoint:
    @pytest.mark.asyncio
    async def test_rejects_non_zip(self, client: AsyncClient, admin_auth_headers: dict):
        resp = await client.post(
            "/api/v1/upload/inspect",
            files={
                "file": ("x.shp", io.BytesIO(b"not a zip"), "application/octet-stream")
            },
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
        meta = [{"primary_file": "a.shp", "name": "A", "include": False}]
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
        with (
            patch(
                "app.services.file_processor.file_processor.process_vector_background",
                new=AsyncMock(return_value=None),
            ),
            patch(
                "app.services.file_processor.file_processor.process_raster_background",
                new=AsyncMock(return_value=None),
            ),
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
                "a.shp": b"s",
                "a.shx": b"s",
                "a.dbf": b"s",
                "a.prj": b"p",
                "b.shp": b"s",
                "b.shx": b"s",
                "b.dbf": b"s",
                "b.prj": b"p",
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
        zip_data = _zip_bytes(
            {"a.shp": b"s", "a.shx": b"s", "a.dbf": b"s", "a.prj": b"p"}
        )
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


class TestBundleRecoveryEndpoints:
    @pytest.mark.asyncio
    async def test_bundle_status_returns_per_dataset_detail(
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
            {"primary_file": "a.shp", "name": "A dataset", "include": True},
            {"primary_file": "b.tif", "name": "B dataset", "include": True},
        ]
        with (
            patch(
                "app.services.file_processor.file_processor.process_vector_background",
                new=AsyncMock(return_value=None),
            ),
            patch(
                "app.services.file_processor.file_processor.process_raster_background",
                new=AsyncMock(return_value=None),
            ),
        ):
            resp = await client.post(
                "/api/v1/upload/bundle",
                files={"file": ("b.zip", io.BytesIO(zip_data), "application/zip")},
                data={"datasets": json.dumps(meta), "category": "reference"},
                headers=admin_auth_headers,
            )
        assert resp.status_code == 202
        bundle_id = resp.json()["bundle_id"]

        status_resp = await client.get(
            f"/api/v1/upload/bundles/{bundle_id}",
            headers=admin_auth_headers,
        )
        assert status_resp.status_code == 200, status_resp.text
        body = status_resp.json()
        assert body["bundle_id"] == bundle_id
        assert len(body["jobs"]) == 2
        names = {j["dataset_name"] for j in body["jobs"]}
        assert names == {"A dataset", "B dataset"}
        for j in body["jobs"]:
            assert "status" in j
            assert "progress" in j
            assert "error_message" in j

    @pytest.mark.asyncio
    async def test_bundle_status_404_unknown_id(
        self, client: AsyncClient, admin_auth_headers: dict
    ):
        resp = await client.get(
            "/api/v1/upload/bundles/00000000-0000-0000-0000-000000000000",
            headers=admin_auth_headers,
        )
        assert resp.status_code == 404


class TestGdbBundleUpload:
    @pytest.mark.asyncio
    async def test_inspect_gdb_zip_returns_per_layer_datasets(
        self, client: AsyncClient, admin_auth_headers: dict, tmp_path: Path
    ):
        gdb_zip = _make_sample_gdb_zip(tmp_path)
        resp = await client.post(
            "/api/v1/upload/inspect",
            files={"file": ("sample.gdb.zip", io.BytesIO(gdb_zip), "application/zip")},
            headers=admin_auth_headers,
        )
        assert resp.status_code == 200, resp.text
        datasets = resp.json()["datasets"]
        gdb_layers = [d for d in datasets if d["format"] == "gdb-vector"]
        assert len(gdb_layers) == 2
        layer_names = {d["layer_name"] for d in gdb_layers}
        assert layer_names == {"points", "more_points"}
        for d in gdb_layers:
            assert d["container_path"] is not None
            assert d["container_path"].endswith(".gdb")
            assert "::" in d["primary_file"]

    @pytest.mark.asyncio
    async def test_bundle_upload_gdb_creates_per_layer_jobs(
        self, client: AsyncClient, admin_auth_headers: dict, tmp_path: Path
    ):
        gdb_zip = _make_sample_gdb_zip(tmp_path)

        # First inspect to learn the detected primary_file keys.
        inspect_resp = await client.post(
            "/api/v1/upload/inspect",
            files={"file": ("sample.gdb.zip", io.BytesIO(gdb_zip), "application/zip")},
            headers=admin_auth_headers,
        )
        assert inspect_resp.status_code == 200
        detected = inspect_resp.json()["datasets"]
        meta = [
            {
                "primary_file": d["primary_file"],
                "name": d["suggested_name"],
                "include": True,
                "container_path": d["container_path"],
                "layer_name": d["layer_name"],
            }
            for d in detected
            if d["format"] == "gdb-vector"
        ]
        assert len(meta) == 2

        # Stub the actual processing — we're verifying the routing only.
        with patch(
            "app.services.file_processor.file_processor.process_vector_background",
            new=AsyncMock(return_value=None),
        ):
            resp = await client.post(
                "/api/v1/upload/bundle",
                files={
                    "file": ("sample.gdb.zip", io.BytesIO(gdb_zip), "application/zip")
                },
                data={"datasets": json.dumps(meta), "category": "reference"},
                headers=admin_auth_headers,
            )
        assert resp.status_code == 202, resp.text
        body = resp.json()
        assert len(body["jobs"]) == 2
        # All jobs share one bundle_id.
        bundle_ids = {j["bundle_id"] for j in body["jobs"]}
        assert bundle_ids == {body["bundle_id"]}


class TestLpkBundleUpload:
    @pytest.mark.asyncio
    async def test_top_level_lpk_accepted(
        self, client: AsyncClient, admin_auth_headers: dict
    ):
        # Build a .lpk that wraps a single shapefile-shaped record.
        lpk_data = _zip_bytes(
            {
                "data/parcels.shp": b"shp",
                "data/parcels.shx": b"shx",
                "data/parcels.dbf": b"dbf",
                "data/parcels.prj": b"prj",
            }
        )
        resp = await client.post(
            "/api/v1/upload/inspect",
            files={
                "file": (
                    "myLayer.lpk",
                    io.BytesIO(lpk_data),
                    "application/octet-stream",
                )
            },
            headers=admin_auth_headers,
        )
        # .lpk extension should be accepted by the bundle inspector.
        assert resp.status_code == 200, resp.text
        datasets = resp.json()["datasets"]
        assert len(datasets) == 1
        assert datasets[0]["format"] == "shapefile"

    @pytest.mark.asyncio
    async def test_inspect_rejects_non_bundle_extension(
        self, client: AsyncClient, admin_auth_headers: dict
    ):
        resp = await client.post(
            "/api/v1/upload/inspect",
            files={
                "file": (
                    "data.shp",
                    io.BytesIO(b"not a zip"),
                    "application/octet-stream",
                )
            },
            headers=admin_auth_headers,
        )
        assert resp.status_code == 400


class TestBundleByNonce:
    @pytest.mark.asyncio
    async def test_recovers_bundle_by_nonce(
        self, client: AsyncClient, admin_auth_headers: dict
    ):
        zip_data = _zip_bytes(
            {"a.shp": b"s", "a.shx": b"s", "a.dbf": b"s", "a.prj": b"p"}
        )
        meta = [{"primary_file": "a.shp", "name": "A", "include": True}]
        nonce = "11111111-2222-3333-4444-555555555555"
        with patch(
            "app.services.file_processor.file_processor.process_vector_background",
            new=AsyncMock(return_value=None),
        ):
            upload_resp = await client.post(
                "/api/v1/upload/bundle",
                files={"file": ("b.zip", io.BytesIO(zip_data), "application/zip")},
                data={
                    "datasets": json.dumps(meta),
                    "category": "reference",
                    "client_nonce": nonce,
                },
                headers=admin_auth_headers,
            )
        assert upload_resp.status_code == 202
        expected_bundle_id = upload_resp.json()["bundle_id"]

        # Now look up the bundle by nonce — simulates the case where the
        # original POST response was lost.
        recovery_resp = await client.get(
            f"/api/v1/upload/bundles/by-nonce/{nonce}",
            headers=admin_auth_headers,
        )
        assert recovery_resp.status_code == 200, recovery_resp.text
        body = recovery_resp.json()
        assert body["bundle_id"] == expected_bundle_id
        assert len(body["jobs"]) == 1
        assert body["jobs"][0]["dataset_name"] == "A"

    @pytest.mark.asyncio
    async def test_unknown_nonce_returns_404(
        self, client: AsyncClient, admin_auth_headers: dict
    ):
        resp = await client.get(
            "/api/v1/upload/bundles/by-nonce/does-not-exist",
            headers=admin_auth_headers,
        )
        assert resp.status_code == 404


class TestBundleListEndpoint:
    @pytest.mark.asyncio
    async def test_list_recent_bundles_includes_just_uploaded(
        self, client: AsyncClient, admin_auth_headers: dict
    ):
        zip_data = _zip_bytes(
            {"a.shp": b"s", "a.shx": b"s", "a.dbf": b"s", "a.prj": b"p"}
        )
        meta = [{"primary_file": "a.shp", "name": "A", "include": True}]
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
        bundle_id = resp.json()["bundle_id"]

        recent = await client.get(
            "/api/v1/upload/bundles?since_minutes=10",
            headers=admin_auth_headers,
        )
        assert recent.status_code == 200
        summaries = recent.json()
        ids = {s["bundle_id"] for s in summaries}
        assert bundle_id in ids
        match = next(s for s in summaries if s["bundle_id"] == bundle_id)
        assert match["total"] == 1
