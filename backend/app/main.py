from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text, func, select

from app.config import settings
from app.database import engine, AsyncSessionLocal
from app.api.v1.router import api_router
from app.api.arcgis.feature_server import router as arcgis_router
from app.models.user import User
from app.models.email_confirmation import EmailConfirmationToken, TokenType
from app.core.security import get_password_hash
from app.crud import email_confirmation as token_crud
from app.services.email import email_service


async def setup_initial_admin(db):
    """Set up the initial admin user if configured and no users exist."""
    # Check if INITIAL_ADMIN_EMAIL is configured
    if not settings.INITIAL_ADMIN_EMAIL or not settings.INITIAL_ADMIN_PASSWORD:
        print("No INITIAL_ADMIN_EMAIL/PASSWORD configured. Skipping admin setup.")
        return

    # Check if any users exist
    result = await db.execute(select(func.count()).select_from(User))
    user_count = result.scalar()

    if user_count > 0:
        print(f"Database has {user_count} existing user(s). Skipping admin setup.")
        return

    # Create admin user with is_active=False (requires email confirmation)
    admin_user = User(
        email=settings.INITIAL_ADMIN_EMAIL,
        hashed_password=get_password_hash(settings.INITIAL_ADMIN_PASSWORD),
        full_name=settings.INITIAL_ADMIN_FULL_NAME,
        is_admin=True,
        is_active=False,  # Requires email confirmation
    )
    db.add(admin_user)
    await db.commit()
    await db.refresh(admin_user)

    print(f"\nCreated initial admin user: {settings.INITIAL_ADMIN_EMAIL}")
    print("Account is INACTIVE until email is confirmed.")

    # Create confirmation token
    confirmation_token = await token_crud.create_confirmation_token(
        db,
        admin_user.id,
        TokenType.ADMIN_SETUP,
        settings.EMAIL_CONFIRMATION_TOKEN_EXPIRE_HOURS,
    )

    # Try to send confirmation email
    sent = await email_service.send_email_confirmation(
        admin_user.email,
        admin_user.full_name,
        confirmation_token.token,
        settings.EMAIL_CONFIRMATION_TOKEN_EXPIRE_HOURS,
    )

    confirmation_url = email_service.get_confirmation_url(confirmation_token.token)

    if sent:
        print(f"Confirmation email sent to {admin_user.email}")
    else:
        # SMTP not configured, print URL to console
        print(f"\n{'='*70}")
        print("IMPORTANT: SMTP is not configured. Use this URL to confirm admin email:")
        print(f"\n  {confirmation_url}")
        print(f"\nThis link expires in {settings.EMAIL_CONFIRMATION_TOKEN_EXPIRE_HOURS} hours.")
        print(f"{'='*70}\n")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Create tables and seed admin user
    async with engine.begin() as conn:
        # Import models to register them
        from app.models import user, dataset, registration, email_confirmation  # noqa: F401
        from app.database import Base

        await conn.run_sync(Base.metadata.create_all)

    # Set up initial admin user (if configured and no users exist)
    async with AsyncSessionLocal() as db:
        await setup_initial_admin(db)

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
