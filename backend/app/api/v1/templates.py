"""Layout template and saved map view endpoints."""

import io
import re
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.api.deps import get_current_user, get_current_editor_or_admin_user
from app.models.user import User
from app.models.template import LayoutTemplate, MapView

router = APIRouter(tags=["templates"])


# ===== Schemas =====

class LayoutTemplateCreate(BaseModel):
    name: str
    description: str | None = None
    project_id: UUID | None = None
    page_config: dict
    elements: list[dict]

class LayoutTemplateUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    page_config: dict | None = None
    elements: list[dict] | None = None

class LayoutTemplateResponse(BaseModel):
    id: UUID
    name: str
    description: str | None
    project_id: UUID | None
    page_config: dict
    elements: list[dict]
    logo_path: str | None
    created_by_id: UUID | None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class MapViewCreate(BaseModel):
    name: str
    description: str | None = None
    project_id: UUID | None = None
    map_config: dict
    layer_configs: list[dict]

class MapViewResponse(BaseModel):
    id: UUID
    name: str
    description: str | None
    project_id: UUID | None
    map_config: dict
    layer_configs: list[dict]
    created_by_id: UUID | None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ===== Layout Template Endpoints =====

@router.post("/layout-templates/", response_model=LayoutTemplateResponse, status_code=201)
async def create_layout_template(
    data: LayoutTemplateCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_editor_or_admin_user),
):
    template = LayoutTemplate(
        name=data.name,
        description=data.description,
        project_id=data.project_id,
        page_config=data.page_config,
        elements=data.elements,
        created_by_id=current_user.id,
    )
    db.add(template)
    await db.commit()
    await db.refresh(template)
    return template


@router.get("/layout-templates/", response_model=list[LayoutTemplateResponse])
async def list_layout_templates(
    project_id: UUID | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = select(LayoutTemplate).order_by(LayoutTemplate.created_at.desc())
    if project_id:
        query = query.where(LayoutTemplate.project_id == project_id)
    result = await db.execute(query)
    return list(result.scalars().all())


@router.get("/layout-templates/{template_id}", response_model=LayoutTemplateResponse)
async def get_layout_template(
    template_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(LayoutTemplate).where(LayoutTemplate.id == template_id))
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Layout template not found")
    return template


@router.put("/layout-templates/{template_id}", response_model=LayoutTemplateResponse)
async def update_layout_template(
    template_id: UUID,
    data: LayoutTemplateUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_editor_or_admin_user),
):
    result = await db.execute(select(LayoutTemplate).where(LayoutTemplate.id == template_id))
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Layout template not found")

    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(template, field, value)
    await db.commit()
    await db.refresh(template)
    return template


@router.delete("/layout-templates/{template_id}")
async def delete_layout_template(
    template_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_editor_or_admin_user),
):
    result = await db.execute(select(LayoutTemplate).where(LayoutTemplate.id == template_id))
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Layout template not found")
    await db.delete(template)
    await db.commit()
    return {"message": "Layout template deleted"}


@router.get("/layout-templates/{template_id}/export/qpt")
async def export_layout_qpt(
    template_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Export layout template as QGIS Print Layout Template (.qpt)."""
    from app.services.layout_generator import generate_qpt

    result = await db.execute(select(LayoutTemplate).where(LayoutTemplate.id == template_id))
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Layout template not found")

    qpt_xml = generate_qpt(template.page_config, template.elements, template.name)
    safe_name = re.sub(r'[^\w\-.]', '_', template.name)

    return StreamingResponse(
        io.BytesIO(qpt_xml.encode("utf-8")),
        media_type="application/xml",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.qpt"'},
    )


@router.get("/layout-templates/{template_id}/export/pagx")
async def export_layout_pagx(
    template_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Export layout template as ArcGIS Pro Layout (.pagx)."""
    from app.services.layout_generator import generate_pagx

    result = await db.execute(select(LayoutTemplate).where(LayoutTemplate.id == template_id))
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Layout template not found")

    pagx_xml = generate_pagx(template.page_config, template.elements, template.name)
    safe_name = re.sub(r'[^\w\-.]', '_', template.name)

    return StreamingResponse(
        io.BytesIO(pagx_xml.encode("utf-8")),
        media_type="application/xml",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.pagx"'},
    )


# ===== Map View Endpoints =====

@router.post("/map-views/", response_model=MapViewResponse, status_code=201)
async def create_map_view(
    data: MapViewCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    view = MapView(
        name=data.name,
        description=data.description,
        project_id=data.project_id,
        map_config=data.map_config,
        layer_configs=data.layer_configs,
        created_by_id=current_user.id,
    )
    db.add(view)
    await db.commit()
    await db.refresh(view)
    return view


@router.get("/map-views/", response_model=list[MapViewResponse])
async def list_map_views(
    project_id: UUID | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = select(MapView).order_by(MapView.created_at.desc())
    if project_id:
        query = query.where(MapView.project_id == project_id)
    result = await db.execute(query)
    return list(result.scalars().all())


@router.get("/map-views/{view_id}", response_model=MapViewResponse)
async def get_map_view(
    view_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(MapView).where(MapView.id == view_id))
    view = result.scalar_one_or_none()
    if not view:
        raise HTTPException(status_code=404, detail="Map view not found")
    return view


@router.delete("/map-views/{view_id}")
async def delete_map_view(
    view_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(MapView).where(MapView.id == view_id))
    view = result.scalar_one_or_none()
    if not view:
        raise HTTPException(status_code=404, detail="Map view not found")
    await db.delete(view)
    await db.commit()
    return {"message": "Map view deleted"}
