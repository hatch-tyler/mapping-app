"""
Tests for CRUD operations.
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud import user as user_crud
from app.crud import dataset as dataset_crud
from app.schemas.user import UserCreate, UserUpdate
from app.schemas.dataset import DatasetCreate, DatasetUpdate
from app.models.user import User
from app.models.dataset import Dataset


class TestUserCRUD:
    """Tests for user CRUD operations."""

    @pytest.mark.asyncio
    async def test_create_user(self, db_session: AsyncSession):
        """Test creating a new user."""
        user_in = UserCreate(
            email="newuser@example.com",
            password="password123",
            full_name="New User",
        )

        user = await user_crud.create_user(db_session, user_in)

        assert user.id is not None
        assert user.email == "newuser@example.com"
        assert user.full_name == "New User"
        assert user.is_active is True
        assert user.is_admin is False
        assert user.hashed_password != "password123"

    @pytest.mark.asyncio
    async def test_create_admin_user(self, db_session: AsyncSession):
        """Test creating an admin user."""
        user_in = UserCreate(
            email="admin@example.com",
            password="adminpass123",
            full_name="Admin User",
        )

        user = await user_crud.create_user(db_session, user_in, is_admin=True)

        assert user.is_admin is True

    @pytest.mark.asyncio
    async def test_get_user_by_id(self, db_session: AsyncSession, test_user: User):
        """Test getting a user by ID."""
        user = await user_crud.get_user(db_session, test_user.id)

        assert user is not None
        assert user.id == test_user.id
        assert user.email == test_user.email

    @pytest.mark.asyncio
    async def test_get_user_by_id_not_found(self, db_session: AsyncSession):
        """Test getting a non-existent user by ID."""
        random_id = uuid.uuid4()
        user = await user_crud.get_user(db_session, random_id)

        assert user is None

    @pytest.mark.asyncio
    async def test_get_user_by_email(self, db_session: AsyncSession, test_user: User):
        """Test getting a user by email."""
        user = await user_crud.get_user_by_email(db_session, test_user.email)

        assert user is not None
        assert user.id == test_user.id

    @pytest.mark.asyncio
    async def test_get_user_by_email_not_found(self, db_session: AsyncSession):
        """Test getting a non-existent user by email."""
        user = await user_crud.get_user_by_email(db_session, "nonexistent@example.com")

        assert user is None

    @pytest.mark.asyncio
    async def test_get_users(self, db_session: AsyncSession, test_user: User, admin_user: User):
        """Test getting a list of users."""
        users = await user_crud.get_users(db_session)

        assert len(users) == 2
        emails = [u.email for u in users]
        assert test_user.email in emails
        assert admin_user.email in emails

    @pytest.mark.asyncio
    async def test_get_users_with_pagination(self, db_session: AsyncSession, test_user: User, admin_user: User):
        """Test getting users with pagination."""
        users = await user_crud.get_users(db_session, skip=0, limit=1)

        assert len(users) == 1

    @pytest.mark.asyncio
    async def test_update_user(self, db_session: AsyncSession, test_user: User):
        """Test updating a user."""
        user_update = UserUpdate(full_name="Updated Name")

        updated_user = await user_crud.update_user(db_session, test_user, user_update)

        assert updated_user.full_name == "Updated Name"
        assert updated_user.email == test_user.email

    @pytest.mark.asyncio
    async def test_update_user_password(self, db_session: AsyncSession, test_user: User):
        """Test updating a user's password."""
        old_hash = test_user.hashed_password
        user_update = UserUpdate(password="newpassword123")

        updated_user = await user_crud.update_user(db_session, test_user, user_update)

        assert updated_user.hashed_password != old_hash
        assert updated_user.hashed_password != "newpassword123"

    @pytest.mark.asyncio
    async def test_update_user_email(self, db_session: AsyncSession, test_user: User):
        """Test updating a user's email."""
        user_update = UserUpdate(email="newemail@example.com")

        updated_user = await user_crud.update_user(db_session, test_user, user_update)

        assert updated_user.email == "newemail@example.com"


class TestRefreshTokenCRUD:
    """Tests for refresh token CRUD operations."""

    @pytest.mark.asyncio
    async def test_create_refresh_token(self, db_session: AsyncSession, test_user: User):
        """Test creating a refresh token."""
        expires_at = datetime.now(timezone.utc) + timedelta(days=7)

        refresh_token = await user_crud.create_refresh_token(
            db_session, test_user.id, "test-token-string", expires_at
        )

        assert refresh_token.user_id == test_user.id
        assert refresh_token.token == "test-token-string"
        assert refresh_token.revoked is False

    @pytest.mark.asyncio
    async def test_get_refresh_token(self, db_session: AsyncSession, test_user: User):
        """Test getting a refresh token."""
        expires_at = datetime.now(timezone.utc) + timedelta(days=7)
        await user_crud.create_refresh_token(
            db_session, test_user.id, "find-this-token", expires_at
        )

        token = await user_crud.get_refresh_token(db_session, "find-this-token")

        assert token is not None
        assert token.token == "find-this-token"

    @pytest.mark.asyncio
    async def test_get_refresh_token_not_found(self, db_session: AsyncSession):
        """Test getting a non-existent refresh token."""
        token = await user_crud.get_refresh_token(db_session, "nonexistent-token")

        assert token is None

    @pytest.mark.asyncio
    async def test_get_refresh_token_revoked(self, db_session: AsyncSession, test_user: User):
        """Test that revoked tokens are not returned."""
        expires_at = datetime.now(timezone.utc) + timedelta(days=7)
        await user_crud.create_refresh_token(
            db_session, test_user.id, "revoked-token", expires_at
        )
        await user_crud.revoke_refresh_token(db_session, "revoked-token")

        token = await user_crud.get_refresh_token(db_session, "revoked-token")

        assert token is None

    @pytest.mark.asyncio
    async def test_revoke_refresh_token(self, db_session: AsyncSession, test_user: User):
        """Test revoking a refresh token."""
        expires_at = datetime.now(timezone.utc) + timedelta(days=7)
        await user_crud.create_refresh_token(
            db_session, test_user.id, "token-to-revoke", expires_at
        )

        await user_crud.revoke_refresh_token(db_session, "token-to-revoke")

        # Token should not be findable after revocation
        token = await user_crud.get_refresh_token(db_session, "token-to-revoke")
        assert token is None

    @pytest.mark.asyncio
    async def test_revoke_nonexistent_token(self, db_session: AsyncSession):
        """Test revoking a non-existent token doesn't raise error."""
        # Should not raise an exception
        await user_crud.revoke_refresh_token(db_session, "nonexistent-token")


class TestDatasetCRUD:
    """Tests for dataset CRUD operations."""

    @pytest.mark.asyncio
    async def test_create_dataset(self, db_session: AsyncSession, admin_user: User):
        """Test creating a new dataset."""
        dataset_in = DatasetCreate(
            name="New Dataset",
            description="A new test dataset",
        )

        dataset = await dataset_crud.create_dataset(
            db_session,
            dataset_in,
            data_type="vector",
            source_format="geojson",
            created_by_id=admin_user.id,
        )

        assert dataset.id is not None
        assert dataset.name == "New Dataset"
        assert dataset.data_type == "vector"
        assert dataset.source_format == "geojson"
        assert dataset.is_visible is True
        assert dataset.created_by_id == admin_user.id

    @pytest.mark.asyncio
    async def test_get_dataset(self, db_session: AsyncSession, test_dataset: Dataset):
        """Test getting a dataset by ID."""
        dataset = await dataset_crud.get_dataset(db_session, test_dataset.id)

        assert dataset is not None
        assert dataset.id == test_dataset.id
        assert dataset.name == test_dataset.name

    @pytest.mark.asyncio
    async def test_get_dataset_not_found(self, db_session: AsyncSession):
        """Test getting a non-existent dataset."""
        random_id = uuid.uuid4()
        dataset = await dataset_crud.get_dataset(db_session, random_id)

        assert dataset is None

    @pytest.mark.asyncio
    async def test_get_datasets(self, db_session: AsyncSession, test_dataset: Dataset):
        """Test getting a list of datasets."""
        datasets, total = await dataset_crud.get_datasets(db_session)

        assert len(datasets) == 1
        assert total == 1
        assert datasets[0].id == test_dataset.id

    @pytest.mark.asyncio
    async def test_get_datasets_visible_only(self, db_session: AsyncSession, admin_user: User):
        """Test getting only visible datasets."""
        # Create visible dataset
        visible_ds = DatasetCreate(name="Visible", description="")
        await dataset_crud.create_dataset(
            db_session, visible_ds, "vector", "geojson", created_by_id=admin_user.id
        )

        # Create hidden dataset
        hidden_ds = DatasetCreate(name="Hidden", description="")
        hidden = await dataset_crud.create_dataset(
            db_session, hidden_ds, "vector", "geojson", created_by_id=admin_user.id
        )
        await dataset_crud.update_visibility(db_session, hidden, False)

        # Get only visible
        datasets, total = await dataset_crud.get_datasets(db_session, visible_only=True)

        assert total == 1
        assert datasets[0].name == "Visible"

    @pytest.mark.asyncio
    async def test_update_dataset(self, db_session: AsyncSession, test_dataset: Dataset):
        """Test updating a dataset."""
        update_data = DatasetUpdate(name="Updated Name", description="Updated description")

        updated = await dataset_crud.update_dataset(db_session, test_dataset, update_data)

        assert updated.name == "Updated Name"
        assert updated.description == "Updated description"

    @pytest.mark.asyncio
    async def test_update_visibility(self, db_session: AsyncSession, test_dataset: Dataset):
        """Test updating dataset visibility."""
        assert test_dataset.is_visible is True

        updated = await dataset_crud.update_visibility(db_session, test_dataset, False)

        assert updated.is_visible is False

    @pytest.mark.asyncio
    async def test_delete_dataset(self, db_session: AsyncSession, test_dataset: Dataset):
        """Test deleting a dataset."""
        dataset_id = test_dataset.id

        await dataset_crud.delete_dataset(db_session, test_dataset)

        # Verify deletion
        deleted = await dataset_crud.get_dataset(db_session, dataset_id)
        assert deleted is None


class TestUploadJobCRUD:
    """Tests for upload job CRUD operations."""

    @pytest.mark.asyncio
    async def test_create_upload_job(self, db_session: AsyncSession, test_dataset: Dataset):
        """Test creating an upload job."""
        job = await dataset_crud.create_upload_job(db_session, test_dataset.id)

        assert job.id is not None
        assert job.dataset_id == test_dataset.id
        assert job.status == "pending"
        assert job.progress == 0

    @pytest.mark.asyncio
    async def test_get_upload_job(self, db_session: AsyncSession, test_dataset: Dataset):
        """Test getting an upload job."""
        created_job = await dataset_crud.create_upload_job(db_session, test_dataset.id)

        job = await dataset_crud.get_upload_job(db_session, created_job.id)

        assert job is not None
        assert job.id == created_job.id

    @pytest.mark.asyncio
    async def test_update_upload_job(self, db_session: AsyncSession, test_dataset: Dataset):
        """Test updating an upload job."""
        job = await dataset_crud.create_upload_job(db_session, test_dataset.id)

        updated = await dataset_crud.update_upload_job(
            db_session, job, status="processing", progress=50
        )

        assert updated.status == "processing"
        assert updated.progress == 50

    @pytest.mark.asyncio
    async def test_update_upload_job_with_error(self, db_session: AsyncSession, test_dataset: Dataset):
        """Test updating an upload job with error."""
        job = await dataset_crud.create_upload_job(db_session, test_dataset.id)

        updated = await dataset_crud.update_upload_job(
            db_session, job, status="failed", error_message="Something went wrong"
        )

        assert updated.status == "failed"
        assert updated.error_message == "Something went wrong"
