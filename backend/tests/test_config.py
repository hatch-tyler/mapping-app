"""
Tests for configuration module.
"""
import os
import pytest
from unittest.mock import patch

from app.config import Settings, get_settings


class TestSettings:
    """Tests for Settings configuration."""

    def test_default_values(self):
        """Test that default values are set."""
        settings = Settings()

        assert settings.ALGORITHM == "HS256"
        assert settings.ACCESS_TOKEN_EXPIRE_MINUTES == 30
        assert settings.REFRESH_TOKEN_EXPIRE_DAYS == 7
        assert settings.UPLOAD_MAX_SIZE_MB == 500

    def test_cors_origins_list(self):
        """Test CORS origins parsing."""
        settings = Settings(CORS_ORIGINS="http://localhost:3000,http://localhost:5173")

        origins = settings.cors_origins_list
        assert len(origins) == 2
        assert "http://localhost:3000" in origins
        assert "http://localhost:5173" in origins

    def test_cors_origins_list_single(self):
        """Test CORS origins with single origin."""
        settings = Settings(CORS_ORIGINS="http://localhost:3000")

        origins = settings.cors_origins_list
        assert len(origins) == 1
        assert origins[0] == "http://localhost:3000"

    def test_cors_origins_list_with_spaces(self):
        """Test CORS origins with extra spaces."""
        settings = Settings(CORS_ORIGINS=" http://localhost:3000 , http://localhost:5173 ")

        origins = settings.cors_origins_list
        assert len(origins) == 2
        assert "http://localhost:3000" in origins
        assert "http://localhost:5173" in origins

    def test_get_settings_cached(self):
        """Test that get_settings returns cached settings."""
        settings1 = get_settings()
        settings2 = get_settings()

        assert settings1 is settings2

    def test_database_url_from_env(self):
        """Test that database URL can be set from environment."""
        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://test:test@localhost/testdb"}):
            settings = Settings()
            assert "postgresql" in settings.DATABASE_URL

    def test_secret_key_from_env(self):
        """Test that secret key can be set from environment."""
        with patch.dict(os.environ, {"SECRET_KEY": "my-super-secret-key"}):
            settings = Settings()
            assert settings.SECRET_KEY == "my-super-secret-key"
