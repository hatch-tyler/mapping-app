"""
Tests for datasets API endpoints.
"""
import uuid
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.models.dataset import Dataset


class TestListDatasets:
    """Tests for listing datasets endpoint."""

    @pytest.mark.asyncio
    async def test_list_datasets(
        self, client: AsyncClient, test_dataset: Dataset, auth_headers: dict
    ):
        """Test listing all datasets."""
        response = await client.get("/api/v1/datasets/", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert "datasets" in data
        assert "total" in data
        assert data["total"] == 1
        assert len(data["datasets"]) == 1
        assert data["datasets"][0]["name"] == test_dataset.name

    @pytest.mark.asyncio
    async def test_list_datasets_empty(self, client: AsyncClient, auth_headers: dict):
        """Test listing datasets when none exist."""
        response = await client.get("/api/v1/datasets/", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 0
        assert data["datasets"] == []

    @pytest.mark.asyncio
    async def test_list_datasets_visible_only(
        self, client: AsyncClient, db_session: AsyncSession, admin_user: User, auth_headers: dict
    ):
        """Test listing only visible datasets."""
        from app.crud import dataset as dataset_crud
        from app.schemas.dataset import DatasetCreate

        # Create visible dataset
        visible = await dataset_crud.create_dataset(
            db_session,
            DatasetCreate(name="Visible"),
            "vector",
            "geojson",
            created_by_id=admin_user.id,
        )

        # Create and hide dataset
        hidden = await dataset_crud.create_dataset(
            db_session,
            DatasetCreate(name="Hidden"),
            "vector",
            "geojson",
            created_by_id=admin_user.id,
        )
        await dataset_crud.update_visibility(db_session, hidden, False)

        response = await client.get(
            "/api/v1/datasets/?visible_only=true",
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 1
        assert data["datasets"][0]["name"] == "Visible"

    @pytest.mark.asyncio
    async def test_list_datasets_pagination(
        self, client: AsyncClient, test_dataset: Dataset, auth_headers: dict
    ):
        """Test listing datasets with pagination."""
        response = await client.get(
            "/api/v1/datasets/?skip=0&limit=10",
            headers=auth_headers,
        )

        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_list_datasets_unauthorized(self, client: AsyncClient):
        """Test listing datasets without authentication."""
        response = await client.get("/api/v1/datasets/")

        assert response.status_code == 403


class TestGetDataset:
    """Tests for getting a single dataset."""

    @pytest.mark.asyncio
    async def test_get_dataset(
        self, client: AsyncClient, test_dataset: Dataset, auth_headers: dict
    ):
        """Test getting a dataset by ID."""
        response = await client.get(
            f"/api/v1/datasets/{test_dataset.id}",
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["id"] == str(test_dataset.id)
        assert data["name"] == test_dataset.name

    @pytest.mark.asyncio
    async def test_get_dataset_not_found(self, client: AsyncClient, auth_headers: dict):
        """Test getting a non-existent dataset."""
        random_id = uuid.uuid4()
        response = await client.get(
            f"/api/v1/datasets/{random_id}",
            headers=auth_headers,
        )

        assert response.status_code == 404


class TestUpdateDataset:
    """Tests for updating a dataset."""

    @pytest.mark.asyncio
    async def test_update_dataset(
        self, client: AsyncClient, test_dataset: Dataset, admin_auth_headers: dict
    ):
        """Test updating a dataset."""
        response = await client.put(
            f"/api/v1/datasets/{test_dataset.id}",
            json={"name": "Updated Name", "description": "Updated description"},
            headers=admin_auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Updated Name"
        assert data["description"] == "Updated description"

    @pytest.mark.asyncio
    async def test_update_dataset_partial(
        self, client: AsyncClient, test_dataset: Dataset, admin_auth_headers: dict
    ):
        """Test partial update of a dataset."""
        original_name = test_dataset.name
        response = await client.put(
            f"/api/v1/datasets/{test_dataset.id}",
            json={"description": "Only description updated"},
            headers=admin_auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == original_name
        assert data["description"] == "Only description updated"

    @pytest.mark.asyncio
    async def test_update_dataset_not_admin(
        self, client: AsyncClient, test_dataset: Dataset, auth_headers: dict
    ):
        """Test that non-admin cannot update dataset."""
        response = await client.put(
            f"/api/v1/datasets/{test_dataset.id}",
            json={"name": "Should Fail"},
            headers=auth_headers,
        )

        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_update_dataset_not_found(
        self, client: AsyncClient, admin_auth_headers: dict
    ):
        """Test updating a non-existent dataset."""
        random_id = uuid.uuid4()
        response = await client.put(
            f"/api/v1/datasets/{random_id}",
            json={"name": "Should Not Work"},
            headers=admin_auth_headers,
        )

        assert response.status_code == 404


class TestDeleteDataset:
    """Tests for deleting a dataset."""

    @pytest.mark.asyncio
    async def test_delete_dataset(
        self, client: AsyncClient, test_dataset: Dataset, admin_auth_headers: dict
    ):
        """Test deleting a dataset."""
        response = await client.delete(
            f"/api/v1/datasets/{test_dataset.id}",
            headers=admin_auth_headers,
        )

        assert response.status_code == 200
        assert "deleted" in response.json()["message"].lower()

        # Verify deletion
        get_response = await client.get(
            f"/api/v1/datasets/{test_dataset.id}",
            headers=admin_auth_headers,
        )
        assert get_response.status_code == 404

    @pytest.mark.asyncio
    async def test_delete_dataset_not_admin(
        self, client: AsyncClient, test_dataset: Dataset, auth_headers: dict
    ):
        """Test that non-admin cannot delete dataset."""
        response = await client.delete(
            f"/api/v1/datasets/{test_dataset.id}",
            headers=auth_headers,
        )

        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_delete_dataset_not_found(
        self, client: AsyncClient, admin_auth_headers: dict
    ):
        """Test deleting a non-existent dataset."""
        random_id = uuid.uuid4()
        response = await client.delete(
            f"/api/v1/datasets/{random_id}",
            headers=admin_auth_headers,
        )

        assert response.status_code == 404


class TestToggleVisibility:
    """Tests for toggling dataset visibility."""

    @pytest.mark.asyncio
    async def test_toggle_visibility_on(
        self, client: AsyncClient, db_session: AsyncSession, admin_user: User, admin_auth_headers: dict
    ):
        """Test turning visibility on."""
        from app.crud import dataset as dataset_crud
        from app.schemas.dataset import DatasetCreate

        # Create hidden dataset
        ds = await dataset_crud.create_dataset(
            db_session,
            DatasetCreate(name="Hidden"),
            "vector",
            "geojson",
            created_by_id=admin_user.id,
        )
        await dataset_crud.update_visibility(db_session, ds, False)

        response = await client.patch(
            f"/api/v1/datasets/{ds.id}/visibility",
            json={"is_visible": True},
            headers=admin_auth_headers,
        )

        assert response.status_code == 200
        assert response.json()["is_visible"] is True

    @pytest.mark.asyncio
    async def test_toggle_visibility_off(
        self, client: AsyncClient, test_dataset: Dataset, admin_auth_headers: dict
    ):
        """Test turning visibility off."""
        assert test_dataset.is_visible is True

        response = await client.patch(
            f"/api/v1/datasets/{test_dataset.id}/visibility",
            json={"is_visible": False},
            headers=admin_auth_headers,
        )

        assert response.status_code == 200
        assert response.json()["is_visible"] is False

    @pytest.mark.asyncio
    async def test_toggle_visibility_not_admin(
        self, client: AsyncClient, test_dataset: Dataset, auth_headers: dict
    ):
        """Test that non-admin cannot toggle visibility."""
        response = await client.patch(
            f"/api/v1/datasets/{test_dataset.id}/visibility",
            json={"is_visible": False},
            headers=auth_headers,
        )

        assert response.status_code == 403


class TestGetDatasetGeoJSON:
    """Tests for getting dataset GeoJSON."""

    @pytest.mark.asyncio
    async def test_geojson_requires_vector_type(
        self, client: AsyncClient, db_session: AsyncSession, admin_user: User, auth_headers: dict
    ):
        """Test that GeoJSON endpoint requires vector dataset."""
        from app.crud import dataset as dataset_crud
        from app.schemas.dataset import DatasetCreate

        # Create raster dataset
        ds = await dataset_crud.create_dataset(
            db_session,
            DatasetCreate(name="Raster"),
            "raster",  # Not vector
            "geotiff",
            created_by_id=admin_user.id,
        )

        response = await client.get(
            f"/api/v1/datasets/{ds.id}/geojson",
            headers=auth_headers,
        )

        assert response.status_code == 400
        assert "vector" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_geojson_requires_table_name(
        self, client: AsyncClient, db_session: AsyncSession, admin_user: User, auth_headers: dict
    ):
        """Test that GeoJSON endpoint requires table name."""
        from app.crud import dataset as dataset_crud
        from app.schemas.dataset import DatasetCreate

        # Create vector dataset without table_name
        ds = await dataset_crud.create_dataset(
            db_session,
            DatasetCreate(name="NoTable"),
            "vector",
            "geojson",
            created_by_id=admin_user.id,
        )

        response = await client.get(
            f"/api/v1/datasets/{ds.id}/geojson",
            headers=auth_headers,
        )

        assert response.status_code == 400
        assert "table" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_geojson_invalid_bbox(
        self, client: AsyncClient, test_dataset: Dataset, auth_headers: dict
    ):
        """Test GeoJSON with invalid bbox format."""
        response = await client.get(
            f"/api/v1/datasets/{test_dataset.id}/geojson?bbox=invalid",
            headers=auth_headers,
        )

        assert response.status_code == 400
        assert "bbox" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_geojson_not_found(self, client: AsyncClient, auth_headers: dict):
        """Test GeoJSON for non-existent dataset."""
        random_id = uuid.uuid4()
        response = await client.get(
            f"/api/v1/datasets/{random_id}/geojson",
            headers=auth_headers,
        )

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_geojson_public_endpoint_no_auth(
        self, client: AsyncClient, db_session: AsyncSession, admin_user: User
    ):
        """Test that GeoJSON endpoint is public and works without authentication."""
        from app.crud import dataset as dataset_crud
        from app.schemas.dataset import DatasetCreate

        # Create a vector dataset without table_name
        ds = await dataset_crud.create_dataset(
            db_session,
            DatasetCreate(name="PublicTest"),
            "vector",
            "geojson",
            created_by_id=admin_user.id,
        )

        # Access without auth headers - should NOT return 401/403
        response = await client.get(f"/api/v1/datasets/{ds.id}/geojson")

        # Should get 400 (no table) rather than 401 (unauthorized)
        # This proves the endpoint is public
        assert response.status_code == 400
        assert "table" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_geojson_public_endpoint_not_found_no_auth(self, client: AsyncClient):
        """Test that GeoJSON endpoint returns 404 for non-existent dataset without auth."""
        random_id = uuid.uuid4()
        response = await client.get(f"/api/v1/datasets/{random_id}/geojson")

        # Should get 404 (not found) rather than 401 (unauthorized)
        assert response.status_code == 404
