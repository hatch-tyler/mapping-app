"""WFS (Web Feature Service) API endpoints."""

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services.wfs import (
    WFSCapabilities,
    WFSDescribeFeature,
    WFSGetFeature,
    WFSTransaction,
)
from app.services.wfs.xml_builder import build_exception_report
from app.models.user import User

router = APIRouter(prefix="/wfs", tags=["wfs"])

# Content types
WFS_XML = "application/xml; charset=utf-8"
WFS_JSON = "application/json; charset=utf-8"

# CORS headers for WFS
WFS_CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "*",
}


def get_param(params: dict[str, str], name: str, default: str | None = None) -> str | None:
    """Get parameter case-insensitively from query params."""
    # Try exact match first
    if name in params:
        return params[name]
    # Try lowercase
    name_lower = name.lower()
    for key, value in params.items():
        if key.lower() == name_lower:
            return value
    return default


def get_int_param(params: dict[str, str], name: str, default: int) -> int:
    """Get integer parameter case-insensitively."""
    value = get_param(params, name)
    if value is None:
        return default
    try:
        return int(value)
    except (ValueError, TypeError):
        return default


async def get_optional_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> User | None:
    """Get user from token if provided, otherwise return None."""
    auth_header = request.headers.get("Authorization")
    if not auth_header:
        # Also check query parameter for GIS client compatibility
        params = dict(request.query_params)
        token = get_param(params, "access_token")
        if not token:
            return None
    else:
        token = auth_header.replace("Bearer ", "")

    try:
        from jose import jwt
        from app.config import settings

        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM],
        )
        if payload.get("type") != "access":
            return None

        from app.crud.user import get_user
        from uuid import UUID

        user = await get_user(db, UUID(payload["sub"]))
        return user
    except Exception:
        return None


@router.options("")
@router.options("/")
async def wfs_options():
    """Handle CORS preflight for WFS endpoint."""
    return Response(
        status_code=204,
        headers=WFS_CORS_HEADERS,
    )


@router.get("")
@router.get("/")
async def wfs_get(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Handle WFS GET requests with case-insensitive parameter handling."""
    # Get all query parameters as a dict
    params = dict(request.query_params)

    # Extract parameters case-insensitively (OGC clients use uppercase)
    service = get_param(params, "service", "WFS")
    wfs_request = get_param(params, "request")
    version = get_param(params, "version", "1.1.0")

    # Validate service
    if service and service.upper() != "WFS":
        content = build_exception_report(
            "InvalidParameterValue",
            "service must be WFS",
            "service",
        )
        return Response(content=content, media_type=WFS_XML, status_code=400, headers=WFS_CORS_HEADERS)

    # Check for required request parameter
    if not wfs_request:
        content = build_exception_report(
            "MissingParameterValue",
            "request parameter is required",
            "request",
        )
        return Response(content=content, media_type=WFS_XML, status_code=400, headers=WFS_CORS_HEADERS)

    # Normalize request name (handle case variations)
    wfs_request_normalized = wfs_request.lower()

    # Route to appropriate handler
    if wfs_request_normalized == "getcapabilities":
        base_url = str(request.url).split("?")[0]
        capabilities = WFSCapabilities(db)
        content = await capabilities.generate(base_url)
        return Response(content=content, media_type=WFS_XML, headers=WFS_CORS_HEADERS)

    elif wfs_request_normalized == "describefeaturetype":
        type_name = get_param(params, "typeName") or get_param(params, "typeNames")
        if not type_name:
            content = build_exception_report(
                "MissingParameterValue",
                "typeName is required",
                "typeName",
            )
            return Response(content=content, media_type=WFS_XML, status_code=400, headers=WFS_CORS_HEADERS)

        describer = WFSDescribeFeature(db)
        content = await describer.generate(type_name)
        return Response(content=content, media_type=WFS_XML, headers=WFS_CORS_HEADERS)

    elif wfs_request_normalized == "getfeature":
        # Extract all GetFeature parameters
        type_name = get_param(params, "typeName") or get_param(params, "typeNames")
        feature_id = get_param(params, "featureId") or get_param(params, "resourceId")
        output_format = get_param(params, "outputFormat", "text/xml; subtype=gml/3.1.1")
        bbox = get_param(params, "bbox")
        max_features = get_int_param(params, "maxFeatures", 1000)
        count = get_int_param(params, "count", 0)
        if count > 0:
            max_features = count
        start_index = get_int_param(params, "startIndex", 0)
        srs_name = get_param(params, "srsName", "EPSG:4326")
        property_name = get_param(params, "propertyName")
        filter_xml = get_param(params, "filter")
        result_type = get_param(params, "resultType", "results")

        if not type_name and not feature_id:
            content = build_exception_report(
                "MissingParameterValue",
                "typeName or featureId is required",
                "typeName",
            )
            return Response(content=content, media_type=WFS_XML, status_code=400, headers=WFS_CORS_HEADERS)

        # If only featureId, extract typeName from it
        if not type_name and feature_id:
            parts = feature_id.split(".")
            if len(parts) >= 2:
                type_name = parts[0]

        # Limit max features for safety
        if max_features > 50000:
            max_features = 50000

        getter = WFSGetFeature(db)
        result = await getter.execute(
            type_name=type_name,
            output_format=output_format,
            bbox=bbox,
            max_features=max_features,
            start_index=start_index,
            srs_name=srs_name,
            property_names=property_name.split(",") if property_name else None,
            feature_id=feature_id,
            filter_xml=filter_xml,
            result_type=result_type,
        )

        # Determine content type
        if output_format and "json" in output_format.lower():
            media_type = WFS_JSON
        else:
            media_type = WFS_XML

        return Response(content=result, media_type=media_type, headers=WFS_CORS_HEADERS)

    else:
        content = build_exception_report(
            "InvalidParameterValue",
            f"Unknown request: {wfs_request}",
            "request",
        )
        return Response(content=content, media_type=WFS_XML, status_code=400, headers=WFS_CORS_HEADERS)


@router.post("")
@router.post("/")
async def wfs_post(
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    """Handle WFS POST requests (Transaction and complex GetFeature)."""
    body = await request.body()
    xml_content = body.decode("utf-8")

    # Detect request type from XML
    if "<Transaction" in xml_content or "<wfs:Transaction" in xml_content:
        transaction = WFSTransaction(db)
        result = await transaction.process(xml_content, user)
        return Response(content=result, media_type=WFS_XML, headers=WFS_CORS_HEADERS)

    elif "<GetFeature" in xml_content or "<wfs:GetFeature" in xml_content:
        content = build_exception_report(
            "OperationNotSupported",
            "POST GetFeature not yet supported. Use GET with query parameters.",
        )
        return Response(content=content, media_type=WFS_XML, status_code=501, headers=WFS_CORS_HEADERS)

    elif "<GetCapabilities" in xml_content or "<wfs:GetCapabilities" in xml_content:
        base_url = str(request.url).split("?")[0]
        capabilities = WFSCapabilities(db)
        content = await capabilities.generate(base_url)
        return Response(content=content, media_type=WFS_XML, headers=WFS_CORS_HEADERS)

    elif "<DescribeFeatureType" in xml_content or "<wfs:DescribeFeatureType" in xml_content:
        import re
        match = re.search(r'typeName["\s]*=\s*["\']([^"\']+)["\']', xml_content)
        if match:
            type_name = match.group(1)
            describer = WFSDescribeFeature(db)
            content = await describer.generate(type_name)
            return Response(content=content, media_type=WFS_XML, headers=WFS_CORS_HEADERS)

        content = build_exception_report(
            "MissingParameterValue",
            "typeName is required",
            "typeName",
        )
        return Response(content=content, media_type=WFS_XML, status_code=400, headers=WFS_CORS_HEADERS)

    else:
        content = build_exception_report(
            "InvalidParameterValue",
            "Unknown or invalid request",
        )
        return Response(content=content, media_type=WFS_XML, status_code=400, headers=WFS_CORS_HEADERS)
