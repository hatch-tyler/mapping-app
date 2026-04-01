"""Layout template and saved map view endpoints."""

import io
import logging
import os
import re
import uuid as uuid_mod
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.api.deps import get_current_user, get_current_editor_or_admin_user
from app.models.user import User
from app.models.template import LayoutTemplate, MapView

logger = logging.getLogger(__name__)

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
    source_file_path: str | None = None
    source_format: str | None = None
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


class MapViewUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    project_id: UUID | None = None
    map_config: dict | None = None
    layer_configs: list[dict] | None = None


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


@router.post(
    "/layout-templates/", response_model=LayoutTemplateResponse, status_code=201
)
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
    result = await db.execute(
        select(LayoutTemplate).where(LayoutTemplate.id == template_id)
    )
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
    result = await db.execute(
        select(LayoutTemplate).where(LayoutTemplate.id == template_id)
    )
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
    result = await db.execute(
        select(LayoutTemplate).where(LayoutTemplate.id == template_id)
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Layout template not found")

    # Delete the original source file from storage if present
    if template.source_file_path:
        try:
            from app.config import settings

            file_path = os.path.join(settings.UPLOAD_DIR, template.source_file_path)
            if os.path.exists(file_path):
                os.remove(file_path)
                # Remove parent directory if empty
                parent = os.path.dirname(file_path)
                if os.path.isdir(parent) and not os.listdir(parent):
                    os.rmdir(parent)
        except Exception as e:
            logger.warning(
                "Failed to delete source file %s: %s", template.source_file_path, e
            )

    await db.delete(template)
    await db.commit()
    return {"message": "Layout template deleted"}


ALLOWED_TEMPLATE_EXTENSIONS = {".qpt", ".pagx"}


@router.post(
    "/layout-templates/import",
    response_model=LayoutTemplateResponse,
    status_code=201,
)
async def import_layout_template(
    file: UploadFile,
    name: str = Form(...),
    description: str | None = Form(None),
    project_id: UUID | None = Form(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_editor_or_admin_user),
):
    """Import a QGIS (.qpt) or ArcGIS Pro (.pagx) layout template file."""
    # Validate extension
    filename = file.filename or "template"
    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED_TEMPLATE_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file format '{ext}'. Allowed: .qpt, .pagx",
        )

    source_format = ext.lstrip(".")

    # Read file content
    content = await file.read()
    xml_content = content.decode("utf-8", errors="replace")

    # Store original file
    template_id = uuid_mod.uuid4()
    rel_path = f"templates/{template_id}/{filename}"
    from app.config import settings

    abs_path = os.path.join(settings.UPLOAD_DIR, rel_path)
    os.makedirs(os.path.dirname(abs_path), exist_ok=True)
    with open(abs_path, "wb") as f:
        f.write(content)

    # Parse template (best-effort)
    page_config: dict = {"width": 279.4, "height": 215.9, "orientation": "landscape"}
    elements: list[dict] = []
    try:
        from app.services.template_parser import parse_template_file

        page_config, elements = parse_template_file(xml_content, source_format)
    except Exception as e:
        logger.warning("Failed to parse %s template: %s", source_format, e)

    template = LayoutTemplate(
        id=template_id,
        name=name,
        description=description,
        project_id=project_id,
        page_config=page_config,
        elements=elements,
        source_file_path=rel_path,
        source_format=source_format,
        created_by_id=current_user.id,
    )
    db.add(template)
    await db.commit()
    await db.refresh(template)
    return template


@router.get("/layout-templates/{template_id}/download")
async def download_original_template(
    template_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Download the original uploaded template file (.qpt or .pagx)."""
    result = await db.execute(
        select(LayoutTemplate).where(LayoutTemplate.id == template_id)
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Layout template not found")
    if not template.source_file_path:
        raise HTTPException(
            status_code=404,
            detail="No source file available (template was created in the designer)",
        )

    from app.config import settings

    abs_path = os.path.join(settings.UPLOAD_DIR, template.source_file_path)
    if not os.path.exists(abs_path):
        raise HTTPException(status_code=404, detail="Source file not found on disk")

    safe_name = re.sub(r"[^\w\-.]", "_", template.name)
    ext = template.source_format or "xml"

    return StreamingResponse(
        open(abs_path, "rb"),
        media_type="application/xml",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.{ext}"'},
    )


@router.get("/layout-templates/{template_id}/export/qpt")
async def export_layout_qpt(
    template_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Export layout template as QGIS Print Layout Template (.qpt)."""
    from app.services.layout_generator import generate_qpt

    result = await db.execute(
        select(LayoutTemplate).where(LayoutTemplate.id == template_id)
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Layout template not found")

    qpt_xml = generate_qpt(template.page_config, template.elements, template.name)
    safe_name = re.sub(r"[^\w\-.]", "_", template.name)

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
    """Export layout template as ArcGIS Pro Layout (.pagx).

    If the template was imported from a .pagx file, returns the original file
    (which ArcGIS Pro can reliably open). Otherwise generates a new one.
    """
    result = await db.execute(
        select(LayoutTemplate).where(LayoutTemplate.id == template_id)
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Layout template not found")

    safe_name = re.sub(r"[^\w\-.]", "_", template.name)

    # Prefer original file if it exists (ArcGIS Pro requires complex internal
    # references like mapDefinitions, uRI links, etc. that we can't regenerate)
    if template.source_format == "pagx" and template.source_file_path:
        from app.config import settings

        abs_path = os.path.join(settings.UPLOAD_DIR, template.source_file_path)
        if os.path.exists(abs_path):
            return StreamingResponse(
                open(abs_path, "rb"),
                media_type="application/json",
                headers={
                    "Content-Disposition": f'attachment; filename="{safe_name}.pagx"'
                },
            )

    # Generate new .pagx for templates created in the designer
    from app.services.layout_generator import generate_pagx

    pagx_json = generate_pagx(template.page_config, template.elements, template.name)

    return StreamingResponse(
        io.BytesIO(pagx_json.encode("utf-8")),
        media_type="application/json",
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


@router.put("/map-views/{view_id}", response_model=MapViewResponse)
async def update_map_view(
    view_id: UUID,
    data: MapViewUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(MapView).where(MapView.id == view_id))
    view = result.scalar_one_or_none()
    if not view:
        raise HTTPException(status_code=404, detail="Map view not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(view, field, value)
    await db.commit()
    await db.refresh(view)
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
