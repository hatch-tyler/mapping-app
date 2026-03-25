import uuid
from datetime import datetime
from typing import TYPE_CHECKING
from sqlalchemy import String, Boolean, Integer, DateTime, Text, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from geoalchemy2 import Geometry

from app.database import Base
from app.models.tag import Tag, dataset_tags

if TYPE_CHECKING:
    from app.models.user import User
    from app.models.project import Project


class Dataset(Base):
    __tablename__ = "datasets"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    data_type: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # 'vector' or 'raster'
    geometry_type: Mapped[str | None] = mapped_column(
        String(50)
    )  # Point, LineString, Polygon, etc.
    source_format: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # geojson, shapefile, geopackage, geotiff
    srid: Mapped[int] = mapped_column(Integer, default=4326)
    bounds = mapped_column(Geometry("POLYGON", srid=4326))
    is_visible: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    is_public: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    style_config: Mapped[dict] = mapped_column(JSONB, default=dict)
    min_zoom: Mapped[int] = mapped_column(Integer, default=0)
    max_zoom: Mapped[int] = mapped_column(Integer, default=22)
    file_path: Mapped[str | None] = mapped_column(String(500))
    table_name: Mapped[str | None] = mapped_column(String(255))
    feature_count: Mapped[int | None] = mapped_column(Integer)
    # Organization fields
    source_type: Mapped[str] = mapped_column(
        String(50), default="local", nullable=False, index=True
    )  # 'local' or 'external'
    category: Mapped[str] = mapped_column(
        String(50), default="reference", nullable=False, index=True
    )  # 'reference' or 'project'
    geographic_scope: Mapped[str | None] = mapped_column(
        String(50), index=True
    )  # 'federal', 'state', 'county', 'local'

    # External service fields (null for local datasets)
    service_url: Mapped[str | None] = mapped_column(String(1000))
    service_type: Mapped[str | None] = mapped_column(
        String(50)
    )  # 'wms', 'wfs', 'arcgis_feature', 'arcgis_map', 'xyz'
    service_layer_id: Mapped[str | None] = mapped_column(String(255))
    service_metadata: Mapped[dict | None] = mapped_column(JSONB)
    last_service_check: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Project linkage
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="SET NULL"), index=True
    )
    is_privileged: Mapped[bool] = mapped_column(Boolean, default=False)

    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    created_by_user: Mapped["User"] = relationship(back_populates="datasets")
    project: Mapped["Project | None"] = relationship(back_populates="datasets")
    tags: Mapped[list["Tag"]] = relationship(secondary=dataset_tags, lazy="selectin")


class UploadJob(Base):
    __tablename__ = "upload_jobs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    dataset_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("datasets.id", ondelete="CASCADE")
    )
    status: Mapped[str] = mapped_column(
        String(50), default="pending"
    )  # pending, processing, completed, failed
    progress: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Relationships
    dataset: Mapped["Dataset"] = relationship()
