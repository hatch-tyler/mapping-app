"""Tests for raster tile serving endpoint."""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.dataset import Dataset


@pytest.fixture
async def raster_dataset(db_session: AsyncSession):
    dataset = Dataset(
        id=uuid.uuid4(),
        name="Test Raster",
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


@pytest.fixture
async def private_raster(db_session: AsyncSession):
    dataset = Dataset(
        id=uuid.uuid4(),
        name="Private Raster",
        data_type="raster",
        source_format="tif",
        source_type="local",
        file_path="/nonexistent/private.tif",
        is_visible=True,
        is_public=False,
    )
    db_session.add(dataset)
    await db_session.commit()
    await db_session.refresh(dataset)
    return dataset


class TestRasterTileEndpoint:
    @pytest.mark.asyncio
    async def test_nonexistent_dataset_returns_404(self, client: AsyncClient):
        response = await client.get(
            f"/api/v1/raster/{uuid.uuid4()}/tiles/10/512/512.png"
        )
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_invalid_zoom_returns_400(
        self, client: AsyncClient, raster_dataset: Dataset
    ):
        response = await client.get(
            f"/api/v1/raster/{raster_dataset.id}/tiles/25/0/0.png"
        )
        assert response.status_code == 400
        assert "Zoom level" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_invalid_coordinates_returns_400(
        self, client: AsyncClient, raster_dataset: Dataset
    ):
        response = await client.get(
            f"/api/v1/raster/{raster_dataset.id}/tiles/1/999/999.png"
        )
        assert response.status_code == 400
        assert "out of range" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_non_raster_dataset_returns_400(
        self, client: AsyncClient, test_dataset: Dataset, auth_headers: dict
    ):
        response = await client.get(
            f"/api/v1/raster/{test_dataset.id}/tiles/10/512/512.png",
            headers=auth_headers,
        )
        assert response.status_code == 400
        assert "raster" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_private_raster_requires_auth(
        self, client: AsyncClient, private_raster: Dataset
    ):
        response = await client.get(
            f"/api/v1/raster/{private_raster.id}/tiles/10/512/512.png"
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_missing_file_returns_404(
        self, client: AsyncClient, raster_dataset: Dataset
    ):
        # file_path points to nonexistent file
        response = await client.get(
            f"/api/v1/raster/{raster_dataset.id}/tiles/10/512/512.png"
        )
        assert response.status_code == 404
        assert "file not found" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_cors_preflight(self, client: AsyncClient, raster_dataset: Dataset):
        response = await client.options(
            f"/api/v1/raster/{raster_dataset.id}/tiles/10/512/512.png"
        )
        assert response.status_code == 204
        assert "Access-Control-Allow-Origin" in response.headers
