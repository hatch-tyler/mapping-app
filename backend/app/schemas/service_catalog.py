from datetime import datetime
from uuid import UUID
from pydantic import BaseModel


class ServiceCatalogCreate(BaseModel):
    name: str
    base_url: str
    description: str | None = None


class ServiceCatalogResponse(BaseModel):
    id: UUID
    name: str
    base_url: str
    description: str | None
    created_by_id: UUID
    created_at: datetime

    class Config:
        from_attributes = True


class ServiceCatalogListResponse(BaseModel):
    catalogs: list[ServiceCatalogResponse]
