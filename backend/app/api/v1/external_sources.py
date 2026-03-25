from uuid import UUID
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.dataset import DatasetCreate, DatasetResponse
from app.schemas.service_catalog import (
    ServiceCatalogCreate,
    ServiceCatalogResponse,
    ServiceCatalogListResponse,
)
from app.crud import dataset as dataset_crud
from app.crud import service_catalog as catalog_crud
from app.api.deps import get_current_admin_user, get_current_user
from app.api.v1.datasets import dataset_to_response
from app.models.user import User
from app.services.external_source import probe_service, browse_directory, proxy_request

router = APIRouter(prefix="/external-sources", tags=["external-sources"])

import ipaddress
from urllib.parse import urlparse
import logging

logger = logging.getLogger(__name__)


def _validate_external_url(url: str) -> None:
    """Validate that a URL is safe for external requests (prevent SSRF)."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError("Only http and https URLs are allowed")
    hostname = parsed.hostname
    if not hostname:
        raise ValueError("Invalid URL")
    # Block private/internal IPs
    try:
        ip = ipaddress.ip_address(hostname)
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
            raise ValueError("URLs pointing to private/internal addresses are not allowed")
    except ValueError as e:
        if "not allowed" in str(e):
            raise
        # hostname is a domain name, not an IP — allow it
        pass
    blocked = ("localhost", "127.0.0.1", "0.0.0.0", "169.254.169.254", "metadata.google")
    if any(b in hostname.lower() for b in blocked):
        raise ValueError("URLs pointing to internal services are not allowed")


class ProbeRequest(BaseModel):
    url: str


class BrowseRequest(BaseModel):
    url: str


class BrowseServiceInfo(BaseModel):
    name: str
    full_name: str
    type: str
    url: str


class BrowseResponse(BaseModel):
    url: str
    folders: list[str]
    services: list[BrowseServiceInfo]


class LayerInfo(BaseModel):
    id: str
    name: str
    geometry_type: str | None
    extent: list[float] | None


class ProbeResponse(BaseModel):
    service_type: str
    layers: list[LayerInfo]
    capabilities_url: str


class RegisterRequest(BaseModel):
    name: str
    description: str | None = None
    service_url: str
    service_type: str
    service_layer_id: str
    category: str = "reference"
    geographic_scope: str | None = None
    project_id: UUID | None = None
    tags: list[str] = []


@router.post("/probe", response_model=ProbeResponse)
async def probe_external_source(
    request: ProbeRequest,
    current_user: User = Depends(get_current_admin_user),
):
    """Auto-detect service type from a URL and return available layers."""
    try:
        _validate_external_url(request.url)
        result = await probe_service(request.url)
        return ProbeResponse(**result)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error("Failed to probe service %s: %s", request.url, e)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to connect to external service",
        )


@router.post("/browse", response_model=BrowseResponse)
async def browse_external_directory(
    request: BrowseRequest,
    current_user: User = Depends(get_current_admin_user),
):
    """Browse an ArcGIS REST services directory for folders and services."""
    try:
        _validate_external_url(request.url)
        result = await browse_directory(request.url)
        return BrowseResponse(**result)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error("Failed to browse directory %s: %s", request.url, e)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to browse external service directory",
        )


# --- Catalog CRUD ---

@router.post("/catalogs", response_model=ServiceCatalogResponse)
async def create_catalog(
    catalog_in: ServiceCatalogCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    try:
        catalog = await catalog_crud.create_catalog(db, catalog_in, current_user.id)
        return catalog
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A catalog with that URL already exists",
        )


@router.get("/catalogs", response_model=ServiceCatalogListResponse)
async def list_catalogs(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    catalogs = await catalog_crud.get_catalogs(db)
    return ServiceCatalogListResponse(catalogs=catalogs)


@router.delete("/catalogs/{catalog_id}")
async def delete_catalog(
    catalog_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    catalog = await catalog_crud.get_catalog(db, catalog_id)
    if not catalog:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Catalog not found")
    await catalog_crud.delete_catalog(db, catalog)
    return {"message": "Catalog deleted"}


@router.post("/register", response_model=DatasetResponse)
async def register_external_source(
    request: RegisterRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """Register an external service as a dataset (no data stored locally)."""
    try:
        _validate_external_url(request.service_url)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    # Determine data_type from service_type
    if request.service_type in ("wms", "arcgis_map", "xyz"):
        data_type = "raster"
    else:
        data_type = "vector"

    dataset_in = DatasetCreate(
        name=request.name,
        description=request.description,
        category=request.category,
        geographic_scope=request.geographic_scope,
        tags=request.tags,
    )

    dataset = await dataset_crud.create_dataset(
        db,
        dataset_in,
        data_type=data_type,
        source_format=request.service_type,
        created_by_id=current_user.id,
        source_type="external",
        service_url=request.service_url,
        service_type=request.service_type,
        service_layer_id=request.service_layer_id,
        project_id=request.project_id,
        last_service_check=datetime.now(timezone.utc),
    )

    return dataset_to_response(dataset)


@router.get("/{dataset_id}/proxy")
async def proxy_external_service(
    dataset_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Proxy requests to an external service to avoid CORS issues."""
    dataset = await dataset_crud.get_dataset(db, dataset_id)
    if not dataset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dataset not found")
    if dataset.source_type != "external" or not dataset.service_url:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Not an external dataset")

    # Build the correct target URL based on service type
    params = dict(request.query_params)
    target_url = dataset.service_url

    if dataset.service_type == "arcgis_feature":
        # ArcGIS Feature Service: append layer ID and /query
        layer_id = dataset.service_layer_id or "0"
        target_url = f"{dataset.service_url.rstrip('/')}/{layer_id}/query"
    elif dataset.service_type == "wfs":
        # WFS: params already contain service/request/typeName
        pass
    elif dataset.service_type == "wms":
        # WMS: params already contain service/request/layers
        pass

    try:
        resp = await proxy_request(target_url, dataset.service_type or "", params)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"External service error: {e}")

    # Determine cache headers based on content type
    content_type = resp.headers.get("content-type", "application/octet-stream")
    cache_control = "public, max-age=3600" if "image" in content_type else "public, max-age=300"

    return Response(
        content=resp.content,
        media_type=content_type,
        headers={
            "Cache-Control": cache_control,
            "Access-Control-Allow-Origin": "*",
        },
    )


@router.post("/{dataset_id}/validate")
async def validate_external_source(
    dataset_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """Re-check if an external service is still accessible."""
    dataset = await dataset_crud.get_dataset(db, dataset_id)
    if not dataset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dataset not found")
    if dataset.source_type != "external" or not dataset.service_url:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Not an external dataset")

    try:
        await probe_service(dataset.service_url)
        dataset.last_service_check = datetime.now(timezone.utc)
        await db.commit()
        return {"status": "ok", "detail": "Service is accessible"}
    except ValueError as e:
        return {"status": "changed", "detail": str(e)}
    except Exception as e:
        return {"status": "unreachable", "detail": str(e)}
