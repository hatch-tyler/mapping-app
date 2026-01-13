"""WFS DescribeFeatureType implementation."""

from uuid import UUID
from lxml import etree
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text, select

from app.models.dataset import Dataset
from app.services.wfs.xml_builder import NAMESPACES, ns_tag, to_xml_string


# Map JSONB types to XSD types
JSONB_TO_XSD = {
    "string": "xsd:string",
    "number": "xsd:double",
    "boolean": "xsd:boolean",
    "null": "xsd:string",
    "object": "xsd:string",
    "array": "xsd:string",
}

# Map geometry types to GML types
# Using MultiSurface for polygons for ArcGIS Pro compatibility
GEOMETRY_TYPE_MAP = {
    "Point": "gml:PointPropertyType",
    "LineString": "gml:CurvePropertyType",
    "Polygon": "gml:MultiSurfacePropertyType",
    "MultiPoint": "gml:MultiPointPropertyType",
    "MultiLineString": "gml:MultiCurvePropertyType",
    "MultiPolygon": "gml:MultiSurfacePropertyType",
    "Geometry": "gml:GeometryPropertyType",
}


class WFSDescribeFeature:
    """Generate WFS DescribeFeatureType response."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def generate(self, type_name: str) -> str:
        """Generate DescribeFeatureType XSD response."""
        # Parse type name (format: gis:{uuid})
        dataset_id = self._parse_type_name(type_name)
        if not dataset_id:
            return self._error_schema(f"Invalid typeName: {type_name}")

        # Get dataset
        stmt = select(Dataset).where(Dataset.id == dataset_id)
        result = await self.db.execute(stmt)
        dataset = result.scalar_one_or_none()

        if not dataset:
            return self._error_schema(f"Feature type not found: {type_name}")

        if not dataset.is_public:
            return self._error_schema(f"Feature type not accessible: {type_name}")

        if dataset.data_type != "vector" or not dataset.table_name:
            return self._error_schema(f"Invalid feature type: {type_name}")

        # Discover schema from data
        properties_schema = await self._discover_properties_schema(dataset.table_name)

        # Build XSD
        return self._build_schema(dataset, properties_schema)

    def _parse_type_name(self, type_name: str) -> UUID | None:
        """Parse type name to extract dataset UUID."""
        try:
            # Handle formats: gis:{uuid}, {uuid}
            if ":" in type_name:
                _, uuid_str = type_name.split(":", 1)
            else:
                uuid_str = type_name
            return UUID(uuid_str)
        except (ValueError, TypeError):
            return None

    async def _discover_properties_schema(self, table_name: str) -> dict[str, str]:
        """Introspect JSONB properties to discover schema."""
        # Sample properties from a subset of rows
        query = text(f"""
            WITH keys AS (
                SELECT DISTINCT jsonb_object_keys(properties) as key
                FROM "{table_name}"
                LIMIT 1000
            ),
            types AS (
                SELECT DISTINCT ON (k.key)
                    k.key,
                    jsonb_typeof(t.properties->k.key) as type
                FROM keys k
                CROSS JOIN (SELECT properties FROM "{table_name}" LIMIT 100) t
                WHERE t.properties ? k.key
            )
            SELECT key, type FROM types ORDER BY key
        """)

        result = await self.db.execute(query)
        rows = result.fetchall()

        schema = {}
        for row in rows:
            xsd_type = JSONB_TO_XSD.get(row[1], "xsd:string")
            schema[row[0]] = xsd_type

        return schema

    def _build_schema(self, dataset: Dataset, properties_schema: dict[str, str]) -> str:
        """Build XSD schema for feature type."""
        nsmap = {
            "xsd": NAMESPACES["xs"],
            "gml": NAMESPACES["gml"],
            "gis": NAMESPACES["gis"],
        }

        root = etree.Element(
            ns_tag("xs", "schema"),
            nsmap=nsmap,
            targetNamespace=NAMESPACES["gis"],
            elementFormDefault="qualified",
        )

        # Import GML schema
        gml_import = etree.SubElement(root, ns_tag("xs", "import"))
        gml_import.set("namespace", NAMESPACES["gml"])
        gml_import.set("schemaLocation", "http://schemas.opengis.net/gml/3.1.1/base/gml.xsd")

        # Feature type element
        type_name = f"feature_{str(dataset.id).replace('-', '_')}"
        elem = etree.SubElement(root, ns_tag("xs", "element"))
        elem.set("name", type_name)
        elem.set("type", f"gis:{type_name}Type")
        elem.set("substitutionGroup", "gml:_Feature")

        # Complex type definition
        complex_type = etree.SubElement(root, ns_tag("xs", "complexType"))
        complex_type.set("name", f"{type_name}Type")

        complex_content = etree.SubElement(complex_type, ns_tag("xs", "complexContent"))
        extension = etree.SubElement(complex_content, ns_tag("xs", "extension"))
        extension.set("base", "gml:AbstractFeatureType")

        sequence = etree.SubElement(extension, ns_tag("xs", "sequence"))

        # Geometry element - named "Shape" for ArcGIS compatibility
        geom_elem = etree.SubElement(sequence, ns_tag("xs", "element"))
        geom_elem.set("name", "Shape")
        geom_type = GEOMETRY_TYPE_MAP.get(dataset.geometry_type or "Geometry", "gml:GeometryPropertyType")
        geom_elem.set("type", geom_type)
        geom_elem.set("minOccurs", "0")

        # Property elements
        for prop_name, prop_type in sorted(properties_schema.items()):
            prop_elem = etree.SubElement(sequence, ns_tag("xs", "element"))
            prop_elem.set("name", prop_name)
            prop_elem.set("type", prop_type)
            prop_elem.set("minOccurs", "0")
            prop_elem.set("nillable", "true")

        return to_xml_string(root)

    def _error_schema(self, message: str) -> str:
        """Return an error schema."""
        from app.services.wfs.xml_builder import build_exception_report
        return build_exception_report("InvalidParameterValue", message, "typeName")
