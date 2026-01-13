"""
Tests for authentication API endpoints.
"""
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User


class TestLogin:
    """Tests for login endpoint."""

    @pytest.mark.asyncio
    async def test_login_success(self, client: AsyncClient, test_user: User):
        """Test successful login."""
        response = await client.post(
            "/api/v1/auth/login",
            json={"email": "test@example.com", "password": "testpassword123"},
        )

        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert "refresh_token" in data
        assert data["token_type"] == "bearer"

    @pytest.mark.asyncio
    async def test_login_invalid_email(self, client: AsyncClient, test_user: User):
        """Test login with invalid email."""
        response = await client.post(
            "/api/v1/auth/login",
            json={"email": "wrong@example.com", "password": "testpassword123"},
        )

        assert response.status_code == 401
        assert "Incorrect email or password" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_login_invalid_password(self, client: AsyncClient, test_user: User):
        """Test login with invalid password."""
        response = await client.post(
            "/api/v1/auth/login",
            json={"email": "test@example.com", "password": "wrongpassword"},
        )

        assert response.status_code == 401
        assert "Incorrect email or password" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_login_inactive_user(self, client: AsyncClient, db_session: AsyncSession):
        """Test login with inactive user."""
        from app.crud import user as user_crud
        from app.schemas.user import UserCreate

        # Create inactive user
        user_in = UserCreate(email="inactive@example.com", password="password123")
        user = await user_crud.create_user(db_session, user_in)
        user.is_active = False
        await db_session.commit()

        response = await client.post(
            "/api/v1/auth/login",
            json={"email": "inactive@example.com", "password": "password123"},
        )

        assert response.status_code == 403
        assert "inactive" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_login_invalid_email_format(self, client: AsyncClient):
        """Test login with invalid email format."""
        response = await client.post(
            "/api/v1/auth/login",
            json={"email": "notanemail", "password": "password123"},
        )

        assert response.status_code == 422  # Validation error


class TestRegister:
    """Tests for register endpoint."""

    @pytest.mark.asyncio
    async def test_register_success(self, client: AsyncClient, admin_auth_headers: dict):
        """Test successful user registration by admin."""
        response = await client.post(
            "/api/v1/auth/register",
            json={
                "email": "newuser@example.com",
                "password": "newpassword123",
                "full_name": "New User",
            },
            headers=admin_auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["email"] == "newuser@example.com"
        assert data["full_name"] == "New User"
        assert data["is_admin"] is False

    @pytest.mark.asyncio
    async def test_register_requires_admin(self, client: AsyncClient, auth_headers: dict):
        """Test that registration requires admin privileges."""
        response = await client.post(
            "/api/v1/auth/register",
            json={
                "email": "newuser@example.com",
                "password": "newpassword123",
            },
            headers=auth_headers,
        )

        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_register_duplicate_email(
        self, client: AsyncClient, admin_auth_headers: dict, test_user: User
    ):
        """Test registration with duplicate email."""
        response = await client.post(
            "/api/v1/auth/register",
            json={
                "email": "test@example.com",  # Already exists
                "password": "newpassword123",
            },
            headers=admin_auth_headers,
        )

        assert response.status_code == 400
        assert "already registered" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_register_unauthorized(self, client: AsyncClient):
        """Test registration without authentication."""
        response = await client.post(
            "/api/v1/auth/register",
            json={
                "email": "newuser@example.com",
                "password": "newpassword123",
            },
        )

        assert response.status_code == 403  # No auth header


class TestRefreshToken:
    """Tests for token refresh endpoint."""

    @pytest.mark.asyncio
    async def test_refresh_token_success(self, client: AsyncClient, test_user: User):
        """Test successful token refresh."""
        # First login to get tokens
        login_response = await client.post(
            "/api/v1/auth/login",
            json={"email": "test@example.com", "password": "testpassword123"},
        )
        tokens = login_response.json()

        # Refresh the token
        response = await client.post(
            "/api/v1/auth/refresh",
            json={"refresh_token": tokens["refresh_token"]},
        )

        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert "refresh_token" in data
        # New tokens should be different
        assert data["refresh_token"] != tokens["refresh_token"]

    @pytest.mark.asyncio
    async def test_refresh_token_invalid(self, client: AsyncClient):
        """Test refresh with invalid token."""
        response = await client.post(
            "/api/v1/auth/refresh",
            json={"refresh_token": "invalid-token"},
        )

        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_refresh_token_used_twice(self, client: AsyncClient, test_user: User):
        """Test that refresh token can only be used once."""
        # Login to get tokens
        login_response = await client.post(
            "/api/v1/auth/login",
            json={"email": "test@example.com", "password": "testpassword123"},
        )
        tokens = login_response.json()

        # First refresh should succeed
        response1 = await client.post(
            "/api/v1/auth/refresh",
            json={"refresh_token": tokens["refresh_token"]},
        )
        assert response1.status_code == 200

        # Second refresh with same token should fail (token revoked)
        response2 = await client.post(
            "/api/v1/auth/refresh",
            json={"refresh_token": tokens["refresh_token"]},
        )
        assert response2.status_code == 401


class TestLogout:
    """Tests for logout endpoint."""

    @pytest.mark.asyncio
    async def test_logout_success(self, client: AsyncClient, test_user: User):
        """Test successful logout."""
        # Login first
        login_response = await client.post(
            "/api/v1/auth/login",
            json={"email": "test@example.com", "password": "testpassword123"},
        )
        tokens = login_response.json()

        # Logout
        response = await client.post(
            "/api/v1/auth/logout",
            json={"refresh_token": tokens["refresh_token"]},
        )

        assert response.status_code == 200
        assert "logged out" in response.json()["message"].lower()

        # Token should be revoked
        refresh_response = await client.post(
            "/api/v1/auth/refresh",
            json={"refresh_token": tokens["refresh_token"]},
        )
        assert refresh_response.status_code == 401
