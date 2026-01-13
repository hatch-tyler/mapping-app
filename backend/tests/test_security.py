"""
Tests for core/security module.
"""
import pytest
from datetime import datetime, timedelta, timezone
from jose import jwt

from app.core.security import (
    create_access_token,
    create_refresh_token,
    verify_token,
    verify_password,
    get_password_hash,
)
from app.config import settings


class TestPasswordHashing:
    """Tests for password hashing functions."""

    def test_get_password_hash_returns_hash(self):
        """Test that password hashing returns a bcrypt hash."""
        password = "mysecretpassword"
        hashed = get_password_hash(password)

        assert hashed != password
        assert hashed.startswith("$2b$")  # bcrypt prefix
        assert len(hashed) == 60  # bcrypt hash length

    def test_get_password_hash_different_for_same_password(self):
        """Test that hashing the same password twice gives different hashes."""
        password = "mysecretpassword"
        hash1 = get_password_hash(password)
        hash2 = get_password_hash(password)

        assert hash1 != hash2  # Different salts

    def test_verify_password_correct(self):
        """Test password verification with correct password."""
        password = "mysecretpassword"
        hashed = get_password_hash(password)

        assert verify_password(password, hashed) is True

    def test_verify_password_incorrect(self):
        """Test password verification with incorrect password."""
        password = "mysecretpassword"
        hashed = get_password_hash(password)

        assert verify_password("wrongpassword", hashed) is False

    def test_verify_password_empty_password(self):
        """Test password verification with empty password."""
        hashed = get_password_hash("somepassword")

        assert verify_password("", hashed) is False

    def test_hash_special_characters(self):
        """Test hashing passwords with special characters."""
        password = "p@$$w0rd!#$%^&*()"
        hashed = get_password_hash(password)

        assert verify_password(password, hashed) is True

    def test_hash_unicode_password(self):
        """Test hashing passwords with unicode characters."""
        password = "пароль密码🔐"
        hashed = get_password_hash(password)

        assert verify_password(password, hashed) is True


class TestAccessToken:
    """Tests for access token creation and verification."""

    def test_create_access_token_returns_string(self):
        """Test that access token creation returns a string."""
        token = create_access_token(subject="user123")

        assert isinstance(token, str)
        assert len(token) > 0

    def test_create_access_token_valid_jwt(self):
        """Test that created token is a valid JWT."""
        user_id = "user123"
        token = create_access_token(subject=user_id)

        # Decode without verification to check structure
        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM]
        )

        assert payload["sub"] == user_id
        assert payload["type"] == "access"
        assert "exp" in payload

    def test_create_access_token_custom_expiry(self):
        """Test access token with custom expiry time."""
        user_id = "user123"
        expires_delta = timedelta(hours=1)
        token = create_access_token(subject=user_id, expires_delta=expires_delta)

        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM]
        )

        # Check expiry is approximately 1 hour from now
        exp_time = datetime.fromtimestamp(payload["exp"], tz=timezone.utc)
        now = datetime.now(timezone.utc)
        diff = exp_time - now

        assert timedelta(minutes=59) < diff < timedelta(hours=1, minutes=1)

    def test_verify_access_token_valid(self):
        """Test verification of a valid access token."""
        user_id = "user123"
        token = create_access_token(subject=user_id)

        payload = verify_token(token, token_type="access")

        assert payload is not None
        assert payload["sub"] == user_id
        assert payload["type"] == "access"

    def test_verify_access_token_invalid_type(self):
        """Test verification fails when checking for wrong token type."""
        token = create_access_token(subject="user123")

        payload = verify_token(token, token_type="refresh")

        assert payload is None

    def test_verify_access_token_expired(self):
        """Test verification of an expired access token."""
        user_id = "user123"
        expires_delta = timedelta(seconds=-1)  # Already expired
        token = create_access_token(subject=user_id, expires_delta=expires_delta)

        payload = verify_token(token, token_type="access")

        assert payload is None

    def test_verify_access_token_invalid_signature(self):
        """Test verification fails with invalid signature."""
        token = create_access_token(subject="user123")

        # Tamper with the token
        parts = token.split(".")
        parts[2] = "invalidsignature"
        tampered_token = ".".join(parts)

        payload = verify_token(tampered_token, token_type="access")

        assert payload is None

    def test_verify_access_token_malformed(self):
        """Test verification fails with malformed token."""
        payload = verify_token("not.a.valid.token", token_type="access")

        assert payload is None

    def test_verify_access_token_empty(self):
        """Test verification fails with empty token."""
        payload = verify_token("", token_type="access")

        assert payload is None


class TestRefreshToken:
    """Tests for refresh token creation and verification."""

    def test_create_refresh_token_returns_tuple(self):
        """Test that refresh token creation returns token and expiry."""
        token, expires_at = create_refresh_token(subject="user123")

        assert isinstance(token, str)
        assert isinstance(expires_at, datetime)
        assert len(token) > 0

    def test_create_refresh_token_valid_jwt(self):
        """Test that created refresh token is a valid JWT."""
        user_id = "user123"
        token, _ = create_refresh_token(subject=user_id)

        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM]
        )

        assert payload["sub"] == user_id
        assert payload["type"] == "refresh"
        assert "exp" in payload

    def test_create_refresh_token_expiry(self):
        """Test refresh token has correct expiry time."""
        token, expires_at = create_refresh_token(subject="user123")

        now = datetime.now(timezone.utc)
        expected_expiry = now + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)

        # Allow 1 minute tolerance
        diff = abs((expires_at - expected_expiry).total_seconds())
        assert diff < 60

    def test_verify_refresh_token_valid(self):
        """Test verification of a valid refresh token."""
        user_id = "user123"
        token, _ = create_refresh_token(subject=user_id)

        payload = verify_token(token, token_type="refresh")

        assert payload is not None
        assert payload["sub"] == user_id
        assert payload["type"] == "refresh"

    def test_verify_refresh_token_as_access_fails(self):
        """Test using refresh token as access token fails."""
        token, _ = create_refresh_token(subject="user123")

        payload = verify_token(token, token_type="access")

        assert payload is None

    def test_access_token_as_refresh_fails(self):
        """Test using access token as refresh token fails."""
        token = create_access_token(subject="user123")

        payload = verify_token(token, token_type="refresh")

        assert payload is None


class TestTokenPayloadContent:
    """Tests for token payload content."""

    def test_access_token_contains_required_claims(self):
        """Test access token contains all required claims."""
        user_id = "test-user-uuid"
        token = create_access_token(subject=user_id)

        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM]
        )

        assert "sub" in payload
        assert "type" in payload
        assert "exp" in payload
        assert payload["sub"] == user_id
        assert payload["type"] == "access"

    def test_refresh_token_contains_required_claims(self):
        """Test refresh token contains all required claims."""
        user_id = "test-user-uuid"
        token, _ = create_refresh_token(subject=user_id)

        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM]
        )

        assert "sub" in payload
        assert "type" in payload
        assert "exp" in payload
        assert payload["sub"] == user_id
        assert payload["type"] == "refresh"
