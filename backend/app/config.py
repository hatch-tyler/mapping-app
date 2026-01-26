from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # Database
    DATABASE_URL: str = "postgresql+asyncpg://gis_user:gis_password@localhost:5432/gis_db"

    # Authentication
    SECRET_KEY: str = "your-secret-key-change-in-production"
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
    ADMIN_EMAIL: str = "admin@example.com"
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
    return Settings()


settings = get_settings()
