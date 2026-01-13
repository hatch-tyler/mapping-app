"""
Tests for users API endpoints.
"""
import pytest
from httpx import AsyncClient

from app.models.user import User


class TestGetCurrentUser:
    """Tests for getting current user endpoint."""

    @pytest.mark.asyncio
    async def test_get_current_user_success(
        self, client: AsyncClient, test_user: User, auth_headers: dict
    ):
        """Test getting current user info."""
        response = await client.get("/api/v1/users/me", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["email"] == test_user.email
        assert data["full_name"] == test_user.full_name
        assert "hashed_password" not in data

    @pytest.mark.asyncio
    async def test_get_current_user_unauthorized(self, client: AsyncClient):
        """Test getting current user without authentication."""
        response = await client.get("/api/v1/users/me")

        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_get_current_user_invalid_token(self, client: AsyncClient):
        """Test getting current user with invalid token."""
        response = await client.get(
            "/api/v1/users/me",
            headers={"Authorization": "Bearer invalid-token"},
        )

        assert response.status_code == 401


class TestUpdateCurrentUser:
    """Tests for updating current user endpoint."""

    @pytest.mark.asyncio
    async def test_update_current_user_name(
        self, client: AsyncClient, test_user: User, auth_headers: dict
    ):
        """Test updating current user's name."""
        response = await client.put(
            "/api/v1/users/me",
            json={"full_name": "Updated Name"},
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["full_name"] == "Updated Name"

    @pytest.mark.asyncio
    async def test_update_current_user_email(
        self, client: AsyncClient, test_user: User, auth_headers: dict
    ):
        """Test updating current user's email."""
        response = await client.put(
            "/api/v1/users/me",
            json={"email": "newemail@example.com"},
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["email"] == "newemail@example.com"

    @pytest.mark.asyncio
    async def test_update_current_user_duplicate_email(
        self, client: AsyncClient, test_user: User, admin_user: User, auth_headers: dict
    ):
        """Test updating email to one that already exists."""
        response = await client.put(
            "/api/v1/users/me",
            json={"email": admin_user.email},  # Admin's email
            headers=auth_headers,
        )

        assert response.status_code == 400
        assert "already registered" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_update_current_user_password(
        self, client: AsyncClient, test_user: User, auth_headers: dict
    ):
        """Test updating current user's password."""
        response = await client.put(
            "/api/v1/users/me",
            json={"password": "newpassword456"},
            headers=auth_headers,
        )

        assert response.status_code == 200

        # Verify new password works
        login_response = await client.post(
            "/api/v1/auth/login",
            json={"email": test_user.email, "password": "newpassword456"},
        )
        assert login_response.status_code == 200


class TestListUsers:
    """Tests for listing users endpoint."""

    @pytest.mark.asyncio
    async def test_list_users_as_admin(
        self, client: AsyncClient, test_user: User, admin_user: User, admin_auth_headers: dict
    ):
        """Test listing users as admin."""
        response = await client.get("/api/v1/users/", headers=admin_auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2
        emails = [u["email"] for u in data]
        assert test_user.email in emails
        assert admin_user.email in emails

    @pytest.mark.asyncio
    async def test_list_users_as_regular_user(
        self, client: AsyncClient, auth_headers: dict
    ):
        """Test that regular users cannot list all users."""
        response = await client.get("/api/v1/users/", headers=auth_headers)

        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_list_users_unauthorized(self, client: AsyncClient):
        """Test listing users without authentication."""
        response = await client.get("/api/v1/users/")

        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_list_users_pagination(
        self, client: AsyncClient, test_user: User, admin_user: User, admin_auth_headers: dict
    ):
        """Test listing users with pagination."""
        response = await client.get(
            "/api/v1/users/?skip=0&limit=1",
            headers=admin_auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
