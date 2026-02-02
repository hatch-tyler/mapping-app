import logging
import shutil
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text, func, select
from sqlalchemy.exc import IntegrityError

from app.config import settings
from app.database import engine, AsyncSessionLocal
from app.api.v1.router import api_router
from app.api.arcgis.feature_server import router as arcgis_router
from app.models.user import User
from app.core.security import get_password_hash
from app.crud import dataset as dataset_crud

logger = logging.getLogger(__name__)

# Arbitrary constant used as the PostgreSQL advisory lock ID to ensure
# only one gunicorn worker runs schema initialisation at a time.
SCHEMA_INIT_LOCK_ID = 294837


async def setup_initial_admin(db):
    """Set up the initial admin user if configured and no users exist."""
    if not settings.INITIAL_ADMIN_EMAIL or not settings.INITIAL_ADMIN_PASSWORD:
        logger.info("No INITIAL_ADMIN_EMAIL/PASSWORD configured. Skipping admin setup.")
        return

    result = await db.execute(select(func.count()).select_from(User))
    if result.scalar() > 0:
        return

    admin_user = User(
        email=settings.INITIAL_ADMIN_EMAIL,
        hashed_password=get_password_hash(settings.INITIAL_ADMIN_PASSWORD),
        full_name=settings.INITIAL_ADMIN_FULL_NAME,
        is_admin=True,
        is_active=True,
    )

    try:
        db.add(admin_user)
        await db.commit()
        logger.info(f"Created initial admin user: {settings.INITIAL_ADMIN_EMAIL}")
    except IntegrityError:
        await db.rollback()


@asynccontextmanager
async def lifespan(app: FastAPI):
    is_postgres = settings.DATABASE_URL.startswith("postgresql")

    async with engine.begin() as conn:
        if is_postgres:
            result = await conn.execute(
                text("SELECT pg_try_advisory_lock(:lock_id)"),
                {"lock_id": SCHEMA_INIT_LOCK_ID},
            )
            acquired = result.scalar()
        else:
            acquired = True  # Non-PG (e.g. SQLite in tests): always run

        if acquired:
            try:
                logger.info("Running database initialization")
                from app.models import user, dataset, registration, email_confirmation  # noqa: F401
                from app.database import Base

                await conn.run_sync(Base.metadata.create_all)
            finally:
                if is_postgres:
                    await conn.execute(
                        text("SELECT pg_advisory_unlock(:lock_id)"),
                        {"lock_id": SCHEMA_INIT_LOCK_ID},
                    )
        else:
            # Another worker is running schema init — wait for it to finish
            logger.info("Schema initialization completed by another worker.")
            await conn.execute(
                text("SELECT pg_advisory_lock(:lock_id)"),
                {"lock_id": SCHEMA_INIT_LOCK_ID},
            )
            await conn.execute(
                text("SELECT pg_advisory_unlock(:lock_id)"),
                {"lock_id": SCHEMA_INIT_LOCK_ID},
            )

    # Set up initial admin user (if configured and no users exist)
    async with AsyncSessionLocal() as db:
        await setup_initial_admin(db)

    # Clean up orphaned processing jobs from previous runs
    async with AsyncSessionLocal() as db:
        try:
            stale_jobs = await dataset_crud.get_stale_processing_jobs(db)
            for job in stale_jobs:
                await dataset_crud.update_upload_job(
                    db,
                    job,
                    status="failed",
                    error_message="Server restarted during processing",
                )
            if stale_jobs:
                logger.info("Marked %d orphaned upload jobs as failed", len(stale_jobs))
        except Exception:
            logger.exception("Failed to clean up orphaned upload jobs")

    # Clean up leftover processing temp files
    processing_dir = Path(settings.UPLOAD_DIR) / "processing"
    if processing_dir.exists():
        shutil.rmtree(str(processing_dir), ignore_errors=True)
        logger.info("Cleaned up processing temp directory")

    yield

    # Shutdown
    await engine.dispose()


app = FastAPI(
    title="GIS API",
    description="Web GIS Application API",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


# Security headers middleware
@app.middleware("http")
async def add_security_headers(request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    return response


# Include API routes
app.include_router(api_router, prefix="/api/v1")

# Include ArcGIS REST API routes (separate from versioned API)
app.include_router(arcgis_router)


@app.get("/health")
@app.get("/api/health")
async def health_check():
    return {"status": "healthy"}


@app.get("/")
async def root():
    return {
        "message": "GIS API",
        "docs": "/api/docs",
        "health": "/health",
    }
