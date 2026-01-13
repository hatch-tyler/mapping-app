"""
Pytest configuration and fixtures for backend tests.
"""
import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone
from typing import AsyncGenerator, Generator
from unittest.mock import MagicMock, Mock

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from httpx import AsyncClient, ASGITransport
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.pool import StaticPool

# Set test environment before importing app modules
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"
os.environ["SECRET_KEY"] = "test-secret-key-for-testing-only"
os.environ["CORS_ORIGINS"] = "http://localhost:3000"

# Mock heavy geospatial dependencies before importing app modules
mock_rasterio = MagicMock()
mock_rio_tiler = MagicMock()
sys.modules['rasterio'] = mock_rasterio
sys.modules['rasterio.crs'] = MagicMock()
sys.modules['rasterio.warp'] = MagicMock()
sys.modules['rio_tiler'] = mock_rio_tiler
sys.modules['rio_tiler.io'] = MagicMock()
sys.modules['rio_tiler.errors'] = MagicMock()

from app.database import Base, get_db
from app.main import app
from app.models.user import User, RefreshToken
from app.models.dataset import Dataset, UploadJob
from app.core.security import get_password_hash, create_access_token, create_refresh_token


# Test database engine
test_engine = create_async_engine(
    "sqlite+aiosqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)

TestAsyncSessionLocal = async_sessionmaker(
    test_engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


@pytest.fixture(scope="session")
def event_loop() -> Generator:
    """Create an event loop for the test session."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(scope="function")
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    """Create a fresh database session for each test."""
    # Enable foreign keys for SQLite
    @event.listens_for(test_engine.sync_engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with TestAsyncSessionLocal() as session:
        yield session

    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture(scope="function")
async def client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    """Create an async test client with database override."""

    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test"
    ) as ac:
        yield ac

    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def test_user(db_session: AsyncSession) -> User:
    """Create a test user."""
    user = User(
        id=uuid.uuid4(),
        email="test@example.com",
        hashed_password=get_password_hash("testpassword123"),
        full_name="Test User",
        is_active=True,
        is_admin=False,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def admin_user(db_session: AsyncSession) -> User:
    """Create an admin test user."""
    user = User(
        id=uuid.uuid4(),
        email="admin@example.com",
        hashed_password=get_password_hash("adminpassword123"),
        full_name="Admin User",
        is_active=True,
        is_admin=True,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def test_dataset(db_session: AsyncSession, admin_user: User) -> Dataset:
    """Create a test dataset."""
    dataset = Dataset(
        id=uuid.uuid4(),
        name="Test Dataset",
        description="A test dataset",
        data_type="vector",
        geometry_type="Point",
        source_format="geojson",
        srid=4326,
        is_visible=True,
        style_config={},
        min_zoom=0,
        max_zoom=22,
        table_name="vector_data_test",
        feature_count=10,
        created_by_id=admin_user.id,
    )
    db_session.add(dataset)
    await db_session.commit()
    await db_session.refresh(dataset)
    return dataset


@pytest.fixture
def user_token(test_user: User) -> str:
    """Generate an access token for the test user."""
    return create_access_token(subject=str(test_user.id))


@pytest.fixture
def admin_token(admin_user: User) -> str:
    """Generate an access token for the admin user."""
    return create_access_token(subject=str(admin_user.id))


@pytest.fixture
def auth_headers(user_token: str) -> dict:
    """Generate authorization headers for regular user."""
    return {"Authorization": f"Bearer {user_token}"}


@pytest.fixture
def admin_auth_headers(admin_token: str) -> dict:
    """Generate authorization headers for admin user."""
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture
def sample_geojson() -> dict:
    """Sample GeoJSON FeatureCollection for testing."""
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [-122.4194, 37.7749]},
                "properties": {"name": "San Francisco", "population": 884363},
            },
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [-118.2437, 34.0522]},
                "properties": {"name": "Los Angeles", "population": 3979576},
            },
        ],
    }
