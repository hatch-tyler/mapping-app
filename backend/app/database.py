from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

_engine_kwargs = {
    "echo": False,
    "pool_pre_ping": True,
}
# pool_size/max_overflow are only valid for connection-pooled backends (not SQLite)
if "sqlite" not in settings.DATABASE_URL:
    _engine_kwargs["pool_size"] = 15
    _engine_kwargs["max_overflow"] = 25

engine = create_async_engine(settings.DATABASE_URL, **_engine_kwargs)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
