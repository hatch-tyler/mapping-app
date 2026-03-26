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
from app.models.dataset import Dataset
from app.services.external_source import probe_service, browse_directory, proxy_request, fetch_all_features

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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Catalog not found")
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
    current_user: User = Depends(get_current_admin_user),
):
    """Register an external service as a dataset (no data stored locally)."""
    try:
        _validate_external_url(request.service_url)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    # Check for duplicate external source
    from sqlalchemy import select
    dup_result = await db.execute(
        select(Dataset).where(
            Dataset.service_url == request.service_url,
            Dataset.service_layer_id == request.service_layer_id,
        ).limit(1)
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
        service_metadata = probe_result.get("metadata")
    except Exception:
        service_metadata = None

    # Determine data_type from service_type
    if request.service_type in ("wms", "arcgis_map", "arcgis_map_export", "arcgis_image", "xyz"):
        data_type = "raster"
    else:
        data_type = "vector"

    # Geographic scope is only valid for reference category
    geographic_scope = request.geographic_scope if request.category != "project" else None

    dataset_in = DatasetCreate(
        name=request.name,
        description=request.description,
        category=request.category,
        geographic_scope=geographic_scope,
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
    elif dataset.service_type == "arcgis_map":
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
        target_url = f"{dataset.service_url.rstrip('/')}/tile/{z}/{y}/{x}"
    elif dataset.service_type == "arcgis_map_export":
        # Dynamic MapServer: route to /export endpoint
        layer_id = dataset.service_layer_id or "0"
        target_url = f"{dataset.service_url.rstrip('/')}/export"
    elif dataset.service_type == "arcgis_image":
        # ArcGIS ImageServer: route to /exportImage endpoint
        target_url = f"{dataset.service_url.rstrip('/')}/exportImage"
    elif dataset.service_type == "wfs":
        # WFS: params already contain service/request/typeName
        pass
    elif dataset.service_type == "wms":
        # WMS: params already contain service/request/layers
        pass

    try:
        resp = await proxy_request(target_url, dataset.service_type or "", params)
    except Exception as e:
        logger.error("External service proxy error for dataset %s: %s", dataset_id, e)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Failed to fetch data from external service")

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
        logger.error("External source validation failed for dataset %s: %s", dataset_id, e)
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
        dataset.service_metadata = metadata
        dataset.last_service_check = datetime.now(timezone.utc)
        await db.commit()
        return {"status": "ok", "metadata": metadata}
    except Exception as e:
        logger.error("Failed to refresh metadata for %s: %s", dataset_id, e)
        raise HTTPException(status_code=502, detail="Failed to fetch metadata from external service")


@router.post("/{dataset_id}/import", response_model=DatasetResponse)
async def import_external_to_local(
    dataset_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """Import an external vector dataset to local PostGIS storage."""
    dataset = await dataset_crud.get_dataset(db, dataset_id)
    if not dataset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dataset not found")
    if dataset.source_type != "external" or not dataset.service_url:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Not an external dataset")
    if dataset.service_type not in ("arcgis_feature", "wfs"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only vector services (ArcGIS Feature, WFS) can be imported",
        )

    table_name = f"vector_data_{str(dataset_id).replace('-', '_')}"

    try:
        # Fetch all features from the external service
        geojson_data = await fetch_all_features(
            dataset.service_url,
            dataset.service_type,
            dataset.service_layer_id or "0",
            max_features=50000,
        )

        if not geojson_data.get("features"):
            raise ValueError("No features returned from the external service")

        # Convert to GeoDataFrame
        from shapely.geometry import shape
        import geopandas as gpd

        rows = []
        geometries = []
        for feat in geojson_data["features"]:
            props = feat.get("properties", {}) or {}
            geom = feat.get("geometry")
            if geom:
                geometries.append(shape(geom))
                rows.append(props)

        if not geometries:
            raise ValueError("No valid geometries found in fetched features")

        gdf = gpd.GeoDataFrame(rows, geometry=geometries, crs="EPSG:4326")

        # Strip Z coordinates if present
        if gdf.geometry.has_z.any():
            from shapely.ops import transform
            gdf['geometry'] = gdf.geometry.apply(
                lambda geom: transform(lambda x, y, z=None: (x, y), geom) if geom and geom.has_z else geom
            )

        # Create PostGIS table and insert features
        from app.services.file_processor import FileProcessor
        processor = FileProcessor()
        await processor._create_vector_table(db, table_name)
        await processor._insert_features(db, table_name, gdf)

        # Get geometry type and bounds
        geom_types = gdf.geometry.geom_type.unique()
        geom_type = geom_types[0] if len(geom_types) == 1 else "Geometry"
        bounds = gdf.total_bounds.tolist()

        # Preserve original service info in metadata
        original_metadata = dataset.service_metadata or {}
        original_metadata["original_service_url"] = dataset.service_url
        original_metadata["original_service_type"] = dataset.service_type
        original_metadata["original_layer_id"] = dataset.service_layer_id
        original_metadata["imported_at"] = datetime.now(timezone.utc).isoformat()
        original_metadata["imported_feature_count"] = len(gdf)

        # Update the dataset record
        dataset.source_type = "local"
        dataset.table_name = table_name
        dataset.geometry_type = geom_type
        dataset.feature_count = len(gdf)
        dataset.data_type = "vector"
        dataset.service_metadata = original_metadata
        # Clear external fields
        dataset.service_url = None
        dataset.service_type = None
        dataset.service_layer_id = None
        await db.commit()
        await db.refresh(dataset)

        return dataset_to_response(dataset)

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to import external dataset %s: %s", dataset_id, e)
        # Clean up partial table on failure
        try:
            from sqlalchemy import text as sa_text
            await db.rollback()
            await db.execute(sa_text(f'DROP TABLE IF EXISTS "{table_name}"'))
            await db.commit()
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to import external dataset: {str(e)}",
        )
