from datetime import datetime
from uuid import UUID
from typing import Any
from pydantic import BaseModel, Field
from enum import Enum


class DatasetBase(BaseModel):
    name: str
    description: str | None = None
    style_config: dict[str, Any] = Field(default_factory=dict)
    min_zoom: int = 0
    max_zoom: int = 22


class DatasetCreate(DatasetBase):
    category: str = "reference"
    geographic_scope: str | None = None
    tags: list[str] = Field(default_factory=list)


class DatasetUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    is_visible: bool | None = None
    is_public: bool | None = None
    style_config: dict[str, Any] | None = None
    min_zoom: int | None = None
    max_zoom: int | None = None
    category: str | None = None
    geographic_scope: str | None = None
    project_id: UUID | None = None
    tags: list[str] | None = None


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
    # Organization fields
    source_type: str = "local"
    category: str = "reference"
    geographic_scope: str | None = None
    service_url: str | None = None
    service_type: str | None = None
    service_layer_id: str | None = None
    project_id: UUID | None = None
    project_name: str | None = None
    linked_project_ids: list[UUID] = Field(default_factory=list)
    linked_project_names: list[str] = Field(default_factory=list)
    service_metadata: dict | None = None
    is_privileged: bool = False
    file_hash: str | None = None
    snapshot_source_id: UUID | None = None
    snapshot_date: str | None = None
    tags: list[str] = Field(default_factory=list)

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
    bundle_id: UUID | None = None
    status: str
    progress: int
    error_message: str | None
    created_at: datetime
    completed_at: datetime | None

    class Config:
        from_attributes = True


# ===== Multi-Dataset Bundle Upload Schemas =====


class DetectedDatasetSchema(BaseModel):
    """A dataset detected within an uploaded ZIP archive."""

    suggested_name: str
    data_type: str  # "vector" or "raster"
    format: str  # "shapefile", "geotiff", "geopackage", "geojson", "grid"
    primary_file: str
    member_files: list[str]
    warnings: list[str] = Field(default_factory=list)


class BundleInspectResponse(BaseModel):
    """Response for /upload/inspect — lists datasets found in a ZIP."""

    datasets: list[DetectedDatasetSchema]


class BundleDatasetMetadata(BaseModel):
    """Per-dataset metadata supplied by the client for a bundle upload."""

    primary_file: str  # identifies which detected dataset this is
    name: str
    description: str | None = None
    include: bool = True


class BundleUploadResponse(BaseModel):
    """Response for /upload/bundle — one job per included dataset."""

    bundle_id: UUID
    jobs: list[UploadJobResponse]


class BundleJobDetail(BaseModel):
    """A single dataset within a bundle with its human-readable name."""

    id: UUID
    dataset_id: UUID
    dataset_name: str
    status: str
    progress: int
    error_message: str | None
    created_at: datetime
    completed_at: datetime | None


class BundleStatusResponse(BaseModel):
    """Full per-dataset status for a bundle (used for 502 recovery)."""

    bundle_id: UUID
    jobs: list[BundleJobDetail]


class BundleSummary(BaseModel):
    """Compact per-bundle summary for "what did I upload recently?" queries."""

    bundle_id: UUID
    created_at: datetime
    total: int
    completed: int
    failed: int
    in_progress: int


# ===== Feature Query Schemas =====


class FieldMetadata(BaseModel):
    """Metadata about a field/column in a dataset."""

    name: str
    field_type: str  # "string", "number", "boolean", "date", "null"


class FieldMetadataResponse(BaseModel):
    """Response containing field metadata for a dataset."""

    dataset_id: UUID
    fields: list[FieldMetadata]


class FeatureRow(BaseModel):
    """A single feature row (without geometry)."""

    id: int
    properties: dict[str, Any]


class FeatureQueryResponse(BaseModel):
    """Paginated response for feature queries."""

    features: list[FeatureRow]
    total_count: int
    page: int
    page_size: int
    total_pages: int


class FilterOperator(str, Enum):
    """Supported filter operators."""

    eq = "eq"
    ne = "ne"
    gt = "gt"
    gte = "gte"
    lt = "lt"
    lte = "lte"
    contains = "contains"
    startswith = "startswith"


class ColumnFilter(BaseModel):
    """A filter to apply to a column."""

    field: str
    operator: FilterOperator
    value: str | float | int | bool


class ExportSelectedRequest(BaseModel):
    """Request to export selected features."""

    feature_ids: list[int]
    format: str = "csv"  # "csv" or "geojson"


# ===== Style/Symbology Schemas =====


class UniqueValuesResponse(BaseModel):
    """Response containing unique values for a field."""

    field: str
    values: list[str | int | float | bool | None]
    total_count: int


class FieldStatisticsResponse(BaseModel):
    """Response containing statistics for a numeric field."""

    field: str
    min: float | None
    max: float | None
    mean: float | None
    count: int
