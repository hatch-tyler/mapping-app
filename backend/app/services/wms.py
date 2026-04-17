"""WMS (Web Map Service) implementation for raster datasets.

Implements OGC WMS 1.3.0 GetCapabilities and GetMap for serving
raster layers to QGIS, ArcGIS Pro, and other desktop GIS clients.
"""

import logging
from xml.etree.ElementTree import Element, SubElement, tostring

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.dataset import Dataset

logger = logging.getLogger(__name__)


async def get_public_raster_datasets(db: AsyncSession) -> list[Dataset]:
    """Get all public raster datasets with file paths."""
    result = await db.execute(
        select(Dataset)
        .where(
            Dataset.is_public == True,
            Dataset.data_type == "raster",
            Dataset.file_path.isnot(None),
        )
        .order_by(Dataset.name)
    )
    return list(result.scalars().all())


async def get_raster_dataset_by_id(db: AsyncSession, dataset_id: str) -> Dataset | None:
    """Get a public raster dataset by ID."""
    from uuid import UUID

    try:
        uid = UUID(dataset_id)
    except ValueError:
        return None
    result = await db.execute(
        select(Dataset).where(
            Dataset.id == uid,
            Dataset.is_public == True,
            Dataset.data_type == "raster",
            Dataset.file_path.isnot(None),
        )
    )
    return result.scalar_one_or_none()


def build_capabilities_xml(datasets: list[Dataset], base_url: str) -> str:
    """Build WMS 1.3.0 GetCapabilities XML."""
    wms_url = f"{base_url}/api/v1/wms"

    root = Element(
        "WMS_Capabilities", version="1.3.0", xmlns="http://www.opengis.net/wms"
    )
    root.set("xmlns:xlink", "http://www.w3.org/1999/xlink")

    # Service
    service = SubElement(root, "Service")
    SubElement(service, "Name").text = "WMS"
    SubElement(service, "Title").text = "GIS Mapping Application - WMS"
    SubElement(service, "Abstract").text = "Raster datasets served via OGC WMS"

    # Capability
    capability = SubElement(root, "Capability")

    # Request
    request_el = SubElement(capability, "Request")

    # GetCapabilities
    get_cap = SubElement(request_el, "GetCapabilities")
    SubElement(get_cap, "Format").text = "text/xml"
    dcp = SubElement(get_cap, "DCPType")
    http = SubElement(dcp, "HTTP")
    get_el = SubElement(http, "Get")
    resource = SubElement(get_el, "OnlineResource")
    resource.set("xlink:type", "simple")
    resource.set("xlink:href", wms_url)

    # GetMap
    get_map = SubElement(request_el, "GetMap")
    SubElement(get_map, "Format").text = "image/png"
    SubElement(get_map, "Format").text = "image/jpeg"
    dcp = SubElement(get_map, "DCPType")
    http = SubElement(dcp, "HTTP")
    get_el = SubElement(http, "Get")
    resource = SubElement(get_el, "OnlineResource")
    resource.set("xlink:type", "simple")
    resource.set("xlink:href", wms_url)

    # Exception
    exception = SubElement(capability, "Exception")
    SubElement(exception, "Format").text = "XML"

    # Root Layer
    root_layer = SubElement(capability, "Layer")
    SubElement(root_layer, "Title").text = "GIS Mapping Application"
    SubElement(root_layer, "CRS").text = "EPSG:4326"
    SubElement(root_layer, "CRS").text = "EPSG:3857"

    for ds in datasets:
        layer = SubElement(root_layer, "Layer", queryable="0", opaque="1")
        SubElement(layer, "Name").text = str(ds.id)
        SubElement(layer, "Title").text = ds.name
        if ds.description:
            SubElement(layer, "Abstract").text = ds.description
        SubElement(layer, "CRS").text = "EPSG:4326"
        SubElement(layer, "CRS").text = "EPSG:3857"

        # Bounding box from service_metadata
        meta = ds.service_metadata or {}
        total_bounds = meta.get("total_bounds")
        if total_bounds and len(total_bounds) == 4:
            minx, miny, maxx, maxy = total_bounds
        else:
            minx, miny, maxx, maxy = -180, -90, 180, 90

        bbox = SubElement(layer, "EX_GeographicBoundingBox")
        SubElement(bbox, "westBoundLongitude").text = str(minx)
        SubElement(bbox, "eastBoundLongitude").text = str(maxx)
        SubElement(bbox, "southBoundLatitude").text = str(miny)
        SubElement(bbox, "northBoundLatitude").text = str(maxy)

        bb4326 = SubElement(layer, "BoundingBox", CRS="EPSG:4326")
        bb4326.set("minx", str(miny))
        bb4326.set("miny", str(minx))
        bb4326.set("maxx", str(maxy))
        bb4326.set("maxy", str(maxx))

    xml_str = tostring(root, encoding="unicode", xml_declaration=False)
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + xml_str


def build_exception_xml(code: str, message: str) -> str:
    """Build WMS ServiceException XML."""
    root = Element("ServiceExceptionReport", version="1.3.0")
    exc = SubElement(root, "ServiceException", code=code)
    exc.text = message
    xml_str = tostring(root, encoding="unicode", xml_declaration=False)
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + xml_str
