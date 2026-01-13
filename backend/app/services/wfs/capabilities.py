"""WFS GetCapabilities implementation."""

from lxml import etree
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.dataset import Dataset
from app.services.wfs.xml_builder import NAMESPACES, ns_tag, to_xml_string


class WFSCapabilities:
    """Generate WFS GetCapabilities response."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def generate(self, base_url: str) -> str:
        """Generate GetCapabilities XML response."""
        # Query public vector datasets
        stmt = select(Dataset).where(
            Dataset.is_public == True,
            Dataset.data_type == "vector",
        )
        result = await self.db.execute(stmt)
        datasets = result.scalars().all()

        # Build XML
        nsmap = {
            "wfs": NAMESPACES["wfs"],
            "ows": NAMESPACES["ows"],
            "ogc": NAMESPACES["ogc"],
            "gml": NAMESPACES["gml"],
            "xlink": NAMESPACES["xlink"],
            "gis": NAMESPACES["gis"],
        }

        root = etree.Element(
            ns_tag("wfs", "WFS_Capabilities"),
            nsmap=nsmap,
            version="1.1.0",
        )
        root.set("updateSequence", "1")

        # Service Identification
        self._add_service_identification(root)

        # Service Provider
        self._add_service_provider(root)

        # Operations Metadata
        self._add_operations_metadata(root, base_url)

        # Feature Type List
        self._add_feature_type_list(root, datasets)

        # Filter Capabilities
        self._add_filter_capabilities(root)

        return to_xml_string(root)

    def _add_service_identification(self, root: etree._Element) -> None:
        """Add ServiceIdentification section."""
        si = etree.SubElement(root, ns_tag("ows", "ServiceIdentification"))

        title = etree.SubElement(si, ns_tag("ows", "Title"))
        title.text = "GIS API WFS Service"

        abstract = etree.SubElement(si, ns_tag("ows", "Abstract"))
        abstract.text = "Web Feature Service for accessing geospatial vector data"

        keywords = etree.SubElement(si, ns_tag("ows", "Keywords"))
        for kw in ["WFS", "GIS", "geospatial", "features"]:
            keyword = etree.SubElement(keywords, ns_tag("ows", "Keyword"))
            keyword.text = kw

        service_type = etree.SubElement(si, ns_tag("ows", "ServiceType"))
        service_type.text = "WFS"

        service_type_version = etree.SubElement(si, ns_tag("ows", "ServiceTypeVersion"))
        service_type_version.text = "1.1.0"

        fees = etree.SubElement(si, ns_tag("ows", "Fees"))
        fees.text = "NONE"

        access = etree.SubElement(si, ns_tag("ows", "AccessConstraints"))
        access.text = "NONE"

    def _add_service_provider(self, root: etree._Element) -> None:
        """Add ServiceProvider section."""
        sp = etree.SubElement(root, ns_tag("ows", "ServiceProvider"))

        name = etree.SubElement(sp, ns_tag("ows", "ProviderName"))
        name.text = "GIS API"

        site = etree.SubElement(sp, ns_tag("ows", "ProviderSite"))
        site.set(ns_tag("xlink", "href"), "http://localhost:8000")

    def _add_operations_metadata(self, root: etree._Element, base_url: str) -> None:
        """Add OperationsMetadata section."""
        om = etree.SubElement(root, ns_tag("ows", "OperationsMetadata"))

        operations = [
            ("GetCapabilities", ["GET", "POST"]),
            ("DescribeFeatureType", ["GET", "POST"]),
            ("GetFeature", ["GET", "POST"]),
            ("Transaction", ["POST"]),
        ]

        for op_name, methods in operations:
            op = etree.SubElement(om, ns_tag("ows", "Operation"))
            op.set("name", op_name)

            dcp = etree.SubElement(op, ns_tag("ows", "DCP"))
            http = etree.SubElement(dcp, ns_tag("ows", "HTTP"))

            for method in methods:
                if method == "GET":
                    get = etree.SubElement(http, ns_tag("ows", "Get"))
                    get.set(ns_tag("xlink", "href"), base_url)
                else:
                    post = etree.SubElement(http, ns_tag("ows", "Post"))
                    post.set(ns_tag("xlink", "href"), base_url)

            # Add parameters
            if op_name == "GetCapabilities":
                self._add_parameter(op, "AcceptVersions", ["1.1.0", "1.0.0"])
                self._add_parameter(op, "AcceptFormats", ["text/xml"])

            elif op_name == "DescribeFeatureType":
                self._add_parameter(op, "outputFormat", [
                    "text/xml; subtype=gml/3.1.1",
                    "application/gml+xml; version=3.1",
                ])

            elif op_name == "GetFeature":
                self._add_parameter(op, "resultType", ["results", "hits"])
                self._add_parameter(op, "outputFormat", [
                    "application/json",
                    "application/gml+xml; version=3.1",
                    "text/xml; subtype=gml/3.1.1",
                ])

    def _add_parameter(self, op: etree._Element, name: str, values: list[str]) -> None:
        """Add a parameter to an operation."""
        param = etree.SubElement(op, ns_tag("ows", "Parameter"))
        param.set("name", name)
        for v in values:
            value = etree.SubElement(param, ns_tag("ows", "Value"))
            value.text = v

    def _add_feature_type_list(self, root: etree._Element, datasets: list[Dataset]) -> None:
        """Add FeatureTypeList section."""
        ftl = etree.SubElement(root, ns_tag("wfs", "FeatureTypeList"))

        # Operations for all feature types
        ops = etree.SubElement(ftl, ns_tag("wfs", "Operations"))
        for op_name in ["Query", "Insert", "Update", "Delete"]:
            op = etree.SubElement(ops, ns_tag("wfs", "Operation"))
            op.text = op_name

        # Feature types from datasets
        for dataset in datasets:
            ft = etree.SubElement(ftl, ns_tag("wfs", "FeatureType"))

            name = etree.SubElement(ft, ns_tag("wfs", "Name"))
            name.text = f"gis:{dataset.id}"

            title = etree.SubElement(ft, ns_tag("wfs", "Title"))
            title.text = dataset.name

            if dataset.description:
                abstract = etree.SubElement(ft, ns_tag("wfs", "Abstract"))
                abstract.text = dataset.description

            default_srs = etree.SubElement(ft, ns_tag("wfs", "DefaultSRS"))
            default_srs.text = f"EPSG:{dataset.srid or 4326}"

            # Output formats
            for fmt in ["application/json", "text/xml; subtype=gml/3.1.1"]:
                output_format = etree.SubElement(ft, ns_tag("wfs", "OutputFormats"))
                format_elem = etree.SubElement(output_format, ns_tag("wfs", "Format"))
                format_elem.text = fmt

            # Bounding box (WGS84)
            bbox = etree.SubElement(ft, ns_tag("ows", "WGS84BoundingBox"))
            lower = etree.SubElement(bbox, ns_tag("ows", "LowerCorner"))
            upper = etree.SubElement(bbox, ns_tag("ows", "UpperCorner"))

            # Use dataset bounds if available, otherwise world extent
            lower.text = "-180 -90"
            upper.text = "180 90"

    def _add_filter_capabilities(self, root: etree._Element) -> None:
        """Add Filter_Capabilities section."""
        fc = etree.SubElement(root, ns_tag("ogc", "Filter_Capabilities"))

        # Spatial capabilities
        sc = etree.SubElement(fc, ns_tag("ogc", "Spatial_Capabilities"))
        geom_ops = etree.SubElement(sc, ns_tag("ogc", "GeometryOperands"))
        for geom in ["gml:Envelope", "gml:Point", "gml:LineString", "gml:Polygon"]:
            geom_op = etree.SubElement(geom_ops, ns_tag("ogc", "GeometryOperand"))
            geom_op.text = geom

        spatial_ops = etree.SubElement(sc, ns_tag("ogc", "SpatialOperators"))
        for op in ["BBOX", "Intersects", "Within", "Contains"]:
            spatial_op = etree.SubElement(spatial_ops, ns_tag("ogc", "SpatialOperator"))
            spatial_op.set("name", op)

        # Scalar capabilities
        scc = etree.SubElement(fc, ns_tag("ogc", "Scalar_Capabilities"))

        logical = etree.SubElement(scc, ns_tag("ogc", "LogicalOperators"))

        comparison = etree.SubElement(scc, ns_tag("ogc", "ComparisonOperators"))
        for op in ["PropertyIsEqualTo", "PropertyIsNotEqualTo", "PropertyIsLessThan",
                   "PropertyIsGreaterThan", "PropertyIsLessThanOrEqualTo",
                   "PropertyIsGreaterThanOrEqualTo", "PropertyIsLike", "PropertyIsNull"]:
            comp_op = etree.SubElement(comparison, ns_tag("ogc", "ComparisonOperator"))
            comp_op.text = op

        # ID capabilities
        idc = etree.SubElement(fc, ns_tag("ogc", "Id_Capabilities"))
        fid = etree.SubElement(idc, ns_tag("ogc", "FID"))
