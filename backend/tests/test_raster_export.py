"""Tests for raster export endpoint."""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.dataset import Dataset


@pytest.fixture
async def raster_dataset(db_session: AsyncSession):
    dataset = Dataset(
        id=uuid.uuid4(),
        name="Export Raster",
        data_type="raster",
        source_format="tif",
        source_type="local",
        file_path="/nonexistent/raster.tif",
        is_visible=True,
        is_public=True,
    )
    db_session.add(dataset)
    await db_session.commit()
    await db_session.refresh(dataset)
    return dataset


class TestRasterExportEndpoint:
    @pytest.mark.asyncio
    async def test_unsupported_format_returns_400(
        self, client: AsyncClient, raster_dataset: Dataset
    ):
        response = await client.get(f"/api/v1/export/{raster_dataset.id}/raster/bmp")
        assert response.status_code == 400
        assert "Unsupported format" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_nonexistent_dataset_returns_404(self, client: AsyncClient):
        response = await client.get(f"/api/v1/export/{uuid.uuid4()}/raster/tif")
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_non_raster_dataset_returns_400(
        self, client: AsyncClient, test_dataset: Dataset
    ):
        response = await client.get(f"/api/v1/export/{test_dataset.id}/raster/tif")
        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_missing_file_returns_404(
        self, client: AsyncClient, raster_dataset: Dataset
    ):
        response = await client.get(f"/api/v1/export/{raster_dataset.id}/raster/tif")
        assert response.status_code == 404
        assert "file not found" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_valid_formats_accepted(
        self, client: AsyncClient, raster_dataset: Dataset
    ):
        for fmt in ("tif", "png", "jpg"):
            response = await client.get(
                f"/api/v1/export/{raster_dataset.id}/raster/{fmt}"
            )
            # Should fail with 404 (file not found) not 400 (bad format)
            assert response.status_code == 404
