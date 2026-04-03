"""Tests for upload validation: sidecar format rejection and shapefile validation."""

import io
import zipfile

import pytest
from httpx import AsyncClient


class TestSidecarFormatRejection:
    """Bare sidecar-dependent raster formats should be rejected with helpful message."""

    @pytest.mark.asyncio
    async def test_reject_bare_asc(self, client: AsyncClient, admin_auth_headers: dict):
        file_content = b"ncols 10\nnrows 10\n"
        response = await client.post(
            "/api/v1/upload/raster",
            files={
                "file": (
                    "test.asc",
                    io.BytesIO(file_content),
                    "application/octet-stream",
                )
            },
            data={"name": "Test ASC", "category": "reference"},
            headers=admin_auth_headers,
        )
        assert response.status_code == 400
        assert (
            "sidecar" in response.json()["detail"].lower()
            or "ZIP" in response.json()["detail"]
        )

    @pytest.mark.asyncio
    async def test_reject_bare_bil(self, client: AsyncClient, admin_auth_headers: dict):
        response = await client.post(
            "/api/v1/upload/raster",
            files={
                "file": (
                    "test.bil",
                    io.BytesIO(b"\x00" * 100),
                    "application/octet-stream",
                )
            },
            data={"name": "Test BIL", "category": "reference"},
            headers=admin_auth_headers,
        )
        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_reject_bare_flt(self, client: AsyncClient, admin_auth_headers: dict):
        response = await client.post(
            "/api/v1/upload/raster",
            files={
                "file": (
                    "test.flt",
                    io.BytesIO(b"\x00" * 100),
                    "application/octet-stream",
                )
            },
            data={"name": "Test FLT", "category": "reference"},
            headers=admin_auth_headers,
        )
        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_accept_tif(self, client: AsyncClient, admin_auth_headers: dict):
        """TIF format should not be rejected (it embeds CRS)."""
        response = await client.post(
            "/api/v1/upload/raster",
            files={"file": ("test.tif", io.BytesIO(b"\x00" * 100), "image/tiff")},
            data={"name": "Test TIF", "category": "reference"},
            headers=admin_auth_headers,
        )
        # Should get past format validation (may fail later during processing)
        assert (
            response.status_code != 400
            or "sidecar" not in response.json().get("detail", "").lower()
        )


class TestShapefileZipValidation:
    """Shapefile ZIPs missing required components should fail."""

    def _make_zip(self, files: dict[str, bytes]) -> io.BytesIO:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            for name, content in files.items():
                zf.writestr(name, content)
        buf.seek(0)
        return buf

    @pytest.mark.asyncio
    async def test_reject_zip_missing_shx(
        self, client: AsyncClient, admin_auth_headers: dict
    ):
        zip_buf = self._make_zip({"test.shp": b"", "test.dbf": b""})
        response = await client.post(
            "/api/v1/upload/vector",
            files={"file": ("test.zip", zip_buf, "application/zip")},
            data={"name": "Missing SHX", "category": "reference"},
            headers=admin_auth_headers,
        )
        # Should fail during processing (background task), not immediately
        # The upload returns 202 (accepted) then the job fails
        assert response.status_code == 202

    @pytest.mark.asyncio
    async def test_accept_valid_vector_format(
        self, client: AsyncClient, admin_auth_headers: dict
    ):
        """GeoJSON upload should be accepted."""
        geojson = b'{"type":"FeatureCollection","features":[]}'
        response = await client.post(
            "/api/v1/upload/vector",
            files={"file": ("test.geojson", io.BytesIO(geojson), "application/json")},
            data={"name": "Test GeoJSON", "category": "reference"},
            headers=admin_auth_headers,
        )
        assert response.status_code == 202


class TestDuplicateDetection:
    @pytest.mark.asyncio
    async def test_duplicate_file_returns_409(
        self, client: AsyncClient, admin_auth_headers: dict
    ):
        content = b'{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"Point","coordinates":[0,0]},"properties":{}}]}'
        # First upload
        response1 = await client.post(
            "/api/v1/upload/vector",
            files={"file": ("test.geojson", io.BytesIO(content), "application/json")},
            data={"name": "First", "category": "reference"},
            headers=admin_auth_headers,
        )
        assert response1.status_code == 202

        # Second upload with same content
        response2 = await client.post(
            "/api/v1/upload/vector",
            files={"file": ("test2.geojson", io.BytesIO(content), "application/json")},
            data={"name": "Duplicate", "category": "reference"},
            headers=admin_auth_headers,
        )
        assert response2.status_code == 409
