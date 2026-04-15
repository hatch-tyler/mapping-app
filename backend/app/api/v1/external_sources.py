from uuid import UUID
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.dataset import DatasetCreate, DatasetResponse, UploadJobResponse
from app.schemas.service_catalog import (
    ServiceCatalogCreate,
    ServiceCatalogResponse,
    ServiceCatalogListResponse,
)
from app.crud import dataset as dataset_crud
from app.crud import service_catalog as catalog_crud
from app.api.deps import (
    get_current_admin_user,
    get_current_editor_or_admin_user,
    get_current_user,
)
from app.api.v1.datasets import dataset_to_response
from app.models.user import User
from app.models.dataset import Dataset
from app.services.external_source import probe_service, browse_directory, proxy_request

router = APIRouter(prefix="/external-sources", tags=["external-sources"])

import ipaddress
import time
from urllib.parse import urlparse
import logging

logger = logging.getLogger(__name__)

# Short-TTL cache of the handful of columns the proxy endpoint needs from the
# Dataset row. Avoids a DB round-trip per tile when panning with multiple
# external layers active. Invalidated implicitly by the 60-second TTL.
_PROXY_DATASET_TTL_SECONDS = 60
_proxy_dataset_cache: dict[UUID, tuple[float, tuple[str, str | None, str | None, str]]] = {}


def _invalidate_proxy_dataset_cache(dataset_id: UUID) -> None:
    _proxy_dataset_cache.pop(dataset_id, None)


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
            raise ValueError(
                "URLs pointing to private/internal addresses are not allowed"
            )
    except ValueError as e:
        if "not allowed" in str(e):
            raise
        # hostname is a domain name, not an IP — allow it
        pass
    blocked = (
        "localhost",
        "127.0.0.1",
        "0.0.0.0",
        "169.254.169.254",
        "metadata.google",
    )
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
    metadata: dict | None = None


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
    current_user: User = Depends(get_current_editor_or_admin_user),
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
    current_user: User = Depends(get_current_editor_or_admin_user),
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
    except Exception as e:
        logger.error("Failed to create catalog: %s", e)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to create catalog. A catalog with that URL may already exist.",
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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Catalog not found"
        )
    await catalog_crud.delete_catalog(db, catalog)
    return {"message": "Catalog deleted"}


@router.post("/refresh-all-metadata")
async def refresh_all_external_metadata(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """Refresh metadata for all external datasets."""
    from sqlalchemy import select

    result = await db.execute(
        select(Dataset).where(
            Dataset.source_type == "external",
            Dataset.service_url.isnot(None),
        )
    )
    datasets = result.scalars().all()

    updated = 0
    failed = 0
    for ds in datasets:
        try:
            probe_result = await probe_service(ds.service_url)
            metadata = probe_result.get("metadata") or {}
            # Store layer extent as total_bounds
            for layer in probe_result.get("layers", []):
                if layer.get("id") == ds.service_layer_id and layer.get("extent"):
                    metadata["total_bounds"] = layer["extent"]
                    break
            else:
                layers = probe_result.get("layers", [])
                if layers and layers[0].get("extent"):
                    metadata["total_bounds"] = layers[0]["extent"]

            # For ArcGIS services, fetch per-layer extent if still missing
            if (
                not metadata.get("total_bounds")
                and ds.service_type
                in ("arcgis_feature", "arcgis_map", "arcgis_map_export", "arcgis_image")
                and ds.service_layer_id
            ):
                from app.services.external_source import fetch_arcgis_layer_extent

                layer_bounds = await fetch_arcgis_layer_extent(
                    ds.service_url, ds.service_layer_id
                )
                if layer_bounds:
                    metadata["total_bounds"] = layer_bounds

            # Fetch feature count for ArcGIS FeatureServer datasets
            if ds.service_type == "arcgis_feature" and ds.service_layer_id:
                from app.services.external_source import fetch_arcgis_feature_count

                feature_count = await fetch_arcgis_feature_count(
                    ds.service_url, ds.service_layer_id
                )
                if feature_count is not None:
                    metadata["feature_count"] = feature_count
                    # Auto-set min_zoom if still at default
                    if ds.min_zoom == 0:
                        from app.services.external_source import suggest_min_zoom

                        ds.min_zoom = suggest_min_zoom(feature_count)

            ds.service_metadata = metadata
            ds.last_service_check = datetime.now(timezone.utc)
            updated += 1
        except Exception:
            failed += 1

    await db.commit()
    return {"updated": updated, "failed": failed, "total": len(datasets)}


@router.post("/register", response_model=DatasetResponse)
async def register_external_source(
    request: RegisterRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_editor_or_admin_user),
):
    """Register an external service as a dataset (no data stored locally)."""
    try:
        _validate_external_url(request.service_url)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    # Check for duplicate external source
    from sqlalchemy import select

    dup_result = await db.execute(
        select(Dataset)
        .where(
            Dataset.service_url == request.service_url,
            Dataset.service_layer_id == request.service_layer_id,
        )
        .limit(1)
    )
    duplicate = dup_result.scalar_one_or_none()
    if duplicate:
        # Include warning in response but still allow registration
        logger.info(
            "Duplicate external source detected: %s (existing: %s)",
            request.service_url,
            duplicate.name,
        )

    # Fetch metadata from the service
    try:
        probe_result = await probe_service(request.service_url)
        service_metadata = probe_result.get("metadata") or {}
        # Store layer extent as total_bounds for zoom-to-extent
        for layer in probe_result.get("layers", []):
            if layer.get("id") == request.service_layer_id and layer.get("extent"):
                service_metadata["total_bounds"] = layer["extent"]
                break
        else:
            # Fallback: use first layer's extent
            layers = probe_result.get("layers", [])
            if layers and layers[0].get("extent"):
                service_metadata["total_bounds"] = layers[0]["extent"]

        # For ArcGIS services, fetch per-layer extent if we still have no bounds
        if not service_metadata.get("total_bounds") and request.service_type in (
            "arcgis_feature",
            "arcgis_map",
            "arcgis_map_export",
            "arcgis_image",
        ):
            from app.services.external_source import fetch_arcgis_layer_extent

            layer_bounds = await fetch_arcgis_layer_extent(
                request.service_url, request.service_layer_id
            )
            if layer_bounds:
                service_metadata["total_bounds"] = layer_bounds
        # Fetch feature count for ArcGIS FeatureServer datasets
        if request.service_type == "arcgis_feature":
            from app.services.external_source import fetch_arcgis_feature_count

            feature_count = await fetch_arcgis_feature_count(
                request.service_url, request.service_layer_id
            )
            if feature_count is not None:
                service_metadata["feature_count"] = feature_count
    except Exception:
        service_metadata = None

    # Determine data_type from service_type
    if request.service_type in (
        "wms",
        "arcgis_map",
        "arcgis_map_export",
        "arcgis_image",
        "xyz",
    ):
        data_type = "raster"
    else:
        data_type = "vector"

    # Auto-set min_zoom for large feature datasets
    auto_min_zoom = 0
    if service_metadata and service_metadata.get("feature_count"):
        from app.services.external_source import suggest_min_zoom

        auto_min_zoom = suggest_min_zoom(service_metadata["feature_count"])

    # Geographic scope is only valid for reference category
    geographic_scope = (
        request.geographic_scope if request.category != "project" else None
    )

    dataset_in = DatasetCreate(
        name=request.name,
        description=request.description,
        category=request.category,
        geographic_scope=geographic_scope,
        tags=request.tags,
        min_zoom=auto_min_zoom,
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
        service_metadata=service_metadata,
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
    now = time.monotonic()
    cached = _proxy_dataset_cache.get(dataset_id)
    if cached and (now - cached[0] < _PROXY_DATASET_TTL_SECONDS):
        service_url, service_type, service_layer_id, source_type = cached[1]
    else:
        dataset = await dataset_crud.get_dataset(db, dataset_id)
        if not dataset:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Dataset not found"
            )
        if dataset.source_type != "external" or not dataset.service_url:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Not an external dataset"
            )
        service_url = dataset.service_url
        service_type = dataset.service_type
        service_layer_id = dataset.service_layer_id
        source_type = dataset.source_type
        _proxy_dataset_cache[dataset_id] = (
            now,
            (service_url, service_type, service_layer_id, source_type),
        )

    # Build the correct target URL based on service type
    params = dict(request.query_params)
    target_url = service_url

    if service_type == "arcgis_feature":
        # ArcGIS Feature Service: append layer ID and /query
        layer_id = service_layer_id or "0"
        target_url = f"{service_url.rstrip('/')}/{layer_id}/query"
    elif service_type == "arcgis_map":
        # Tile-cached MapServer: reconstruct /tile/{z}/{y}/{x} URL
        z = params.pop("z", None)
        y = params.pop("y", None)
        x = params.pop("x", None)
        params.pop("tile", None)
        if z is None or y is None or x is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Missing required tile parameters: z, y, x",
            )
        target_url = f"{service_url.rstrip('/')}/tile/{z}/{y}/{x}"
    elif service_type == "arcgis_map_export":
        # Dynamic MapServer: route to /export endpoint
        target_url = f"{service_url.rstrip('/')}/export"
    elif service_type == "arcgis_image":
        # ArcGIS ImageServer: route to /exportImage endpoint
        target_url = f"{service_url.rstrip('/')}/exportImage"
    elif service_type == "wfs":
        # WFS: params already contain service/request/typeName
        pass
    elif service_type == "wms":
        # WMS: params already contain service/request/layers
        pass

    try:
        resp = await proxy_request(target_url, service_type or "", params)
    except Exception as e:
        logger.warning("External service proxy error for dataset %s: %s", dataset_id, e)
        # Return empty GeoJSON for feature queries so tiles render as empty instead of erroring
        f_param = params.get("f", "")
        if f_param in ("geojson", "json"):
            return Response(
                content='{"type":"FeatureCollection","features":[]}',
                media_type="application/json",
                headers={
                    "Cache-Control": "no-cache",
                    "Access-Control-Allow-Origin": "*",
                },
            )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to fetch data from external service",
        )

    # Determine cache headers based on content type
    content_type = resp.headers.get("content-type", "application/octet-stream")
    cache_control = (
        "public, max-age=3600" if "image" in content_type else "public, max-age=300"
    )

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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Dataset not found"
        )
    if dataset.source_type != "external" or not dataset.service_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Not an external dataset"
        )

    try:
        await probe_service(dataset.service_url)
        dataset.last_service_check = datetime.now(timezone.utc)
        await db.commit()
        return {"status": "ok", "detail": "Service is accessible"}
    except ValueError as e:
        return {"status": "changed", "detail": str(e)}
    except Exception as e:
        logger.error(
            "External source validation failed for dataset %s: %s", dataset_id, e
        )
        return {"status": "unreachable", "detail": "Service is unreachable"}


@router.post("/{dataset_id}/refresh-metadata")
async def refresh_external_metadata(
    dataset_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """Re-probe an external service and update its metadata."""
    dataset = await dataset_crud.get_dataset(db, dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    if dataset.source_type != "external" or not dataset.service_url:
        raise HTTPException(status_code=400, detail="Not an external dataset")

    try:
        result = await probe_service(dataset.service_url)
        metadata = result.get("metadata") or {}
        # Store layer extent as total_bounds
        for layer in result.get("layers", []):
            if layer.get("id") == dataset.service_layer_id and layer.get("extent"):
                metadata["total_bounds"] = layer["extent"]
                break
        else:
            layers = result.get("layers", [])
            if layers and layers[0].get("extent"):
                metadata["total_bounds"] = layers[0]["extent"]

        # For ArcGIS services, fetch per-layer extent if still missing
        if (
            not metadata.get("total_bounds")
            and dataset.service_type
            in ("arcgis_feature", "arcgis_map", "arcgis_map_export", "arcgis_image")
            and dataset.service_layer_id
        ):
            from app.services.external_source import fetch_arcgis_layer_extent

            layer_bounds = await fetch_arcgis_layer_extent(
                dataset.service_url, dataset.service_layer_id
            )
            if layer_bounds:
                metadata["total_bounds"] = layer_bounds

        # Fetch feature count for ArcGIS FeatureServer datasets
        if dataset.service_type == "arcgis_feature" and dataset.service_layer_id:
            from app.services.external_source import fetch_arcgis_feature_count

            feature_count = await fetch_arcgis_feature_count(
                dataset.service_url, dataset.service_layer_id
            )
            if feature_count is not None:
                metadata["feature_count"] = feature_count
                if dataset.min_zoom == 0:
                    from app.services.external_source import suggest_min_zoom

                    dataset.min_zoom = suggest_min_zoom(feature_count)

        dataset.service_metadata = metadata
        dataset.last_service_check = datetime.now(timezone.utc)
        await db.commit()
        return {"status": "ok", "metadata": metadata}
    except Exception as e:
        logger.error("Failed to refresh metadata for %s: %s", dataset_id, e)
        raise HTTPException(
            status_code=502, detail="Failed to fetch metadata from external service"
        )


@router.post("/{dataset_id}/import", response_model=UploadJobResponse, status_code=202)
async def import_external_to_local(
    dataset_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_editor_or_admin_user),
):
    """Import an external vector dataset to local PostGIS storage.

    Spawns a background task and returns immediately with a job ID.
    Poll /upload/status/{job_id} to track progress.
    """
    dataset = await dataset_crud.get_dataset(db, dataset_id)
    if not dataset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Dataset not found"
        )
    if dataset.source_type != "external" or not dataset.service_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Not an external dataset"
        )
    if dataset.service_type not in ("arcgis_feature", "wfs"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only vector services (ArcGIS Feature, WFS) can be imported",
        )

    # Create job for progress tracking (reuses upload job infrastructure)
    job = await dataset_crud.create_upload_job(db, dataset.id)

    # Capture service info before spawning background task
    service_url = dataset.service_url
    service_type = dataset.service_type
    service_layer_id = dataset.service_layer_id or "0"
    original_metadata = (
        dict(dataset.service_metadata) if dataset.service_metadata else {}
    )

    # Spawn background task
    import asyncio
    from app.services.import_service import import_external_background

    def _log_task_error(task: asyncio.Task) -> None:
        if task.cancelled():
            return
        exc = task.exception()
        if exc:
            logger.error("Background import task failed: %s", exc, exc_info=exc)

    task = asyncio.create_task(
        import_external_background(
            dataset_id=dataset_id,
            job_id=job.id,
            service_url=service_url,
            service_type=service_type,
            service_layer_id=service_layer_id,
            original_metadata=original_metadata,
        )
    )
    task.add_done_callback(_log_task_error)

    return job
