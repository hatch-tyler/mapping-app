from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.config import settings
from app.database import engine, AsyncSessionLocal
from app.api.v1.router import api_router
from app.models.user import User
from app.core.security import get_password_hash


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Create tables and seed admin user
    async with engine.begin() as conn:
        # Import models to register them
        from app.models import user, dataset  # noqa: F401
        from app.database import Base

        await conn.run_sync(Base.metadata.create_all)

    # Create default admin user if not exists
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            text("SELECT id FROM users WHERE email = 'admin@example.com'")
        )
        if not result.scalar():
            admin_user = User(
                email="admin@example.com",
                hashed_password=get_password_hash("admin123"),
                full_name="Admin User",
                is_admin=True,
                is_active=True,
            )
            db.add(admin_user)
            await db.commit()
            print("Created default admin user: admin@example.com / admin123")

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


@app.get("/health")
async def health_check():
    return {"status": "healthy"}


@app.get("/")
async def root():
    return {
        "message": "GIS API",
        "docs": "/api/docs",
        "health": "/health",
    }
