from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.service_catalog import ServiceCatalog
from app.schemas.service_catalog import ServiceCatalogCreate


async def get_catalogs(db: AsyncSession) -> list[ServiceCatalog]:
    result = await db.execute(select(ServiceCatalog).order_by(ServiceCatalog.name))
    return list(result.scalars().all())


async def get_catalog(db: AsyncSession, catalog_id: UUID) -> ServiceCatalog | None:
    result = await db.execute(
        select(ServiceCatalog).where(ServiceCatalog.id == catalog_id)
    )
    return result.scalar_one_or_none()


async def create_catalog(
    db: AsyncSession, catalog_in: ServiceCatalogCreate, created_by_id: UUID
) -> ServiceCatalog:
    catalog = ServiceCatalog(
        name=catalog_in.name,
        base_url=catalog_in.base_url.rstrip("/"),
        description=catalog_in.description,
        created_by_id=created_by_id,
    )
    db.add(catalog)
    await db.commit()
    await db.refresh(catalog)
    return catalog


async def delete_catalog(db: AsyncSession, catalog: ServiceCatalog) -> None:
    await db.delete(catalog)
    await db.commit()
