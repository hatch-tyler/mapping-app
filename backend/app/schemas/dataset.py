from datetime import datetime
from uuid import UUID
from typing import Any
from pydantic import BaseModel, Field


class DatasetBase(BaseModel):
    name: str
    description: str | None = None
    style_config: dict[str, Any] = Field(default_factory=dict)
    min_zoom: int = 0
    max_zoom: int = 22


class DatasetCreate(DatasetBase):
    pass


class DatasetUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    is_visible: bool | None = None
    is_public: bool | None = None
    style_config: dict[str, Any] | None = None
    min_zoom: int | None = None
    max_zoom: int | None = None


class DatasetResponse(DatasetBase):
    id: UUID
    data_type: str
    geometry_type: str | None
    source_format: str
    srid: int
    bounds: list[float] | None = None  # [minx, miny, maxx, maxy]
    is_visible: bool
    is_public: bool
    file_path: str | None
    table_name: str | None
    feature_count: int | None
    created_by_id: UUID | None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class DatasetListResponse(BaseModel):
    datasets: list[DatasetResponse]
    total: int


class VisibilityUpdate(BaseModel):
    is_visible: bool


class PublicStatusUpdate(BaseModel):
    is_public: bool


class UploadJobResponse(BaseModel):
    id: UUID
    dataset_id: UUID
    status: str
    progress: int
    error_message: str | None
    created_at: datetime
    completed_at: datetime | None

    class Config:
        from_attributes = True
