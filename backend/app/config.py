from pydantic_settings import BaseSettings
from functools import lru_cache

_INSECURE_DEFAULT_KEY = "your-secret-key-change-in-production"


class Settings(BaseSettings):
    # Database
    DATABASE_URL: str = (
        "postgresql+asyncpg://gis_user:gis_password@localhost:5432/gis_db"
    )

    # Authentication
    SECRET_KEY: str = _INSECURE_DEFAULT_KEY
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # CORS
    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:3000"

    # File storage
    UPLOAD_DIR: str = "/app/data/uploads"
    RASTER_DIR: str = "/app/data/rasters"
    UPLOAD_MAX_SIZE_MB: int = 500

    # Email settings
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM_EMAIL: str = "noreply@example.com"
    SMTP_FROM_NAME: str = "GIS Application"
    APP_URL: str = "http://localhost:5173"

    # Initial admin setup (required for first run)
    INITIAL_ADMIN_EMAIL: str | None = None
    INITIAL_ADMIN_PASSWORD: str | None = None
    INITIAL_ADMIN_FULL_NAME: str = "Administrator"
    EMAIL_CONFIRMATION_TOKEN_EXPIRE_HOURS: int = 24

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",")]

    class Config:
        env_file = ".env"
        case_sensitive = True
        extra = "ignore"


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    # Block startup if the default secret key is used outside local development.
    # In production (Docker / Gunicorn) DATABASE_URL always points to the real DB,
    # so checking for "localhost" is a reliable proxy for "local dev".
    if s.SECRET_KEY == _INSECURE_DEFAULT_KEY and "localhost" not in s.DATABASE_URL:
        raise RuntimeError(
            "SECRET_KEY is set to the insecure default. "
            "Set a strong random SECRET_KEY via environment variable before running in production."
        )
    return s


settings = get_settings()
