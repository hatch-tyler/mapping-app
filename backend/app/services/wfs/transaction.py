"""WFS-T Transaction implementation for Insert, Update, Delete operations."""

import json
import re
from uuid import UUID
from typing import Any
import defusedxml.ElementTree as ET
from lxml import etree
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text, select

from app.models.dataset import Dataset
from app.models.user import User
from app.services.wfs.xml_builder import (
    NAMESPACES,
    ns_tag,
    to_xml_string,
    gml_to_wkt,
    build_exception_report,
)
from app.services.wfs.filter_parser import parse_ogc_filter


# Namespaces for parsing
WFS_NS = "http://www.opengis.net/wfs"
GML_NS = "http://www.opengis.net/gml"
GIS_NS = "http://localhost:8000/gis"


class WFSTransaction:
    """Process WFS-T Transaction requests."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def process(self, xml_body: str, user: User | None) -> str:
        """Process a WFS Transaction request."""
        # Require authentication for transactions
        if not user:
            return build_exception_report(
                "NoApplicableCode",
                "Authentication required for transactions",
            )

        if not user.is_admin:
            return build_exception_report(
                "NoApplicableCode",
                "Admin privileges required for transactions",
            )

        try:
            root = ET.fromstring(xml_body)
        except Exception as e:
            return build_exception_report(
                "InvalidParameterValue",
                f"Invalid XML: {str(e)}",
            )

        results = {
            "totalInserted": 0,
            "totalUpdated": 0,
            "totalDeleted": 0,
            "insertedFeatureIds": [],
            "errors": [],
        }

        # Process each operation in order
        for child in root:
            tag = self._local_name(child)

            try:
                if tag == "Insert":
                    result = await self._handle_insert(child)
                    results["totalInserted"] += result["count"]
                    results["insertedFeatureIds"].extend(result["ids"])

                elif tag == "Update":
                    result = await self._handle_update(child)
                    results["totalUpdated"] += result["count"]

                elif tag == "Delete":
                    result = await self._handle_delete(child)
                    results["totalDeleted"] += result["count"]

            except Exception as e:
                results["errors"].append(str(e))

        # Commit transaction if no errors
        if not results["errors"]:
            await self.db.commit()
        else:
            await self.db.rollback()
            return build_exception_report(
                "OperationProcessingFailed",
                "; ".join(results["errors"]),
            )

        return self._build_response(results)

    def _local_name(self, elem: Any) -> str:
        """Get local name without namespace."""
        tag = elem.tag
        if "}" in tag:
            return tag.split("}")[1]
        return tag

    def _parse_type_name(self, type_name: str) -> UUID | None:
        """Parse type name to extract dataset UUID."""
        try:
            if ":" in type_name:
                _, uuid_str = type_name.split(":", 1)
            else:
                uuid_str = type_name
            return UUID(uuid_str)
        except (ValueError, TypeError):
            return None

    async def _get_dataset(self, type_name: str) -> Dataset:
        """Get dataset by type name with validation."""
        dataset_id = self._parse_type_name(type_name)
        if not dataset_id:
            raise ValueError(f"Invalid typeName: {type_name}")

        stmt = select(Dataset).where(Dataset.id == dataset_id)
        result = await self.db.execute(stmt)
        dataset = result.scalar_one_or_none()

        if not dataset:
            raise ValueError(f"Feature type not found: {type_name}")

        if not dataset.is_public:
            raise ValueError(f"Feature type not accessible: {type_name}")

        if dataset.data_type != "vector" or not dataset.table_name:
            raise ValueError(f"Invalid feature type: {type_name}")

        # Validate table name
        if not re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', dataset.table_name):
            raise ValueError("Invalid table configuration")

        return dataset

    async def _handle_insert(self, elem: Any) -> dict:
        """Handle Insert operation."""
        type_name = elem.get("typeName")
        if not type_name:
            # Try to infer from child elements
            for child in elem:
                child_tag = self._local_name(child)
                if child_tag.startswith("feature_"):
                    # Extract UUID from feature_xxx_xxx_xxx
                    uuid_part = child_tag.replace("feature_", "").replace("_", "-")
                    type_name = f"gis:{uuid_part}"
                    break

        if not type_name:
            raise ValueError("Insert requires typeName attribute or feature element")

        dataset = await self._get_dataset(type_name)
        table_name = dataset.table_name

        inserted_ids = []

        # Process each feature element
        for child in elem:
            child_tag = self._local_name(child)

            # Skip non-feature elements
            if child_tag in ["typeName", "handle"]:
                continue

            # Extract geometry
            geom_wkt = None
            geom_elem = child.find(f".//{{{GIS_NS}}}geometry")
            if geom_elem is None:
                geom_elem = child.find(".//geometry")

            if geom_elem is not None and len(geom_elem) > 0:
                gml_elem = geom_elem[0]
                # Convert to lxml element for gml_to_wkt
                gml_str = ET.tostring(gml_elem, encoding="unicode")
                lxml_elem = etree.fromstring(gml_str)
                geom_wkt = gml_to_wkt(lxml_elem)

            # Extract properties
            properties = {}
            for prop_child in child:
                prop_tag = self._local_name(prop_child)
                if prop_tag not in ["geometry", "boundedBy"]:
                    if prop_child.text:
                        properties[prop_tag] = prop_child.text

            # Insert into database
            if geom_wkt:
                query = text(f"""
                    INSERT INTO "{table_name}" (geom, properties)
                    VALUES (ST_GeomFromText(:wkt, 4326), :props::jsonb)
                    RETURNING id
                """)
                result = await self.db.execute(query, {
                    "wkt": geom_wkt,
                    "props": json.dumps(properties),
                })
            else:
                query = text(f"""
                    INSERT INTO "{table_name}" (properties)
                    VALUES (:props::jsonb)
                    RETURNING id
                """)
                result = await self.db.execute(query, {
                    "props": json.dumps(properties),
                })

            new_id = result.scalar()
            inserted_ids.append(f"gis:{dataset.id}.{new_id}")

        return {"count": len(inserted_ids), "ids": inserted_ids}

    async def _handle_update(self, elem: Any) -> dict:
        """Handle Update operation."""
        type_name = elem.get("typeName")
        if not type_name:
            raise ValueError("Update requires typeName attribute")

        dataset = await self._get_dataset(type_name)
        table_name = dataset.table_name

        # Extract properties to update
        updates = {}
        for prop_elem in elem.findall(f".//{{{WFS_NS}}}Property"):
            name_elem = prop_elem.find(f".//{{{WFS_NS}}}Name")
            if name_elem is None:
                name_elem = prop_elem.find(".//Name")

            value_elem = prop_elem.find(f".//{{{WFS_NS}}}Value")
            if value_elem is None:
                value_elem = prop_elem.find(".//Value")

            if name_elem is not None and name_elem.text:
                prop_name = name_elem.text.strip()
                prop_value = value_elem.text if value_elem is not None else None
                updates[prop_name] = prop_value

        if not updates:
            return {"count": 0}

        # Extract filter
        filter_elem = elem.find(f".//{{{WFS_NS}}}Filter")
        if filter_elem is None:
            filter_elem = elem.find(".//Filter")

        if filter_elem is None:
            raise ValueError("Update requires Filter element")

        filter_xml = ET.tostring(filter_elem, encoding="unicode")
        filter_clause, filter_params = parse_ogc_filter(filter_xml)

        if not filter_clause:
            raise ValueError("Invalid or unsupported filter")

        # Build update statement
        # Update JSONB properties
        set_clauses = []
        for prop_name, prop_value in updates.items():
            param_name = f"upd_{prop_name}"
            set_clauses.append(f"properties = jsonb_set(properties, '{{{prop_name}}}', to_jsonb(:{param_name}::text))")
            filter_params[param_name] = prop_value

        set_sql = ", ".join(set_clauses)

        query = text(f"""
            UPDATE "{table_name}"
            SET {set_sql}
            WHERE {filter_clause}
        """)

        result = await self.db.execute(query, filter_params)
        return {"count": result.rowcount}

    async def _handle_delete(self, elem: Any) -> dict:
        """Handle Delete operation."""
        type_name = elem.get("typeName")
        if not type_name:
            raise ValueError("Delete requires typeName attribute")

        dataset = await self._get_dataset(type_name)
        table_name = dataset.table_name

        # Extract filter
        filter_elem = elem.find(f".//{{{WFS_NS}}}Filter")
        if filter_elem is None:
            filter_elem = elem.find(".//Filter")

        if filter_elem is None:
            raise ValueError("Delete requires Filter element")

        filter_xml = ET.tostring(filter_elem, encoding="unicode")
        filter_clause, filter_params = parse_ogc_filter(filter_xml)

        if not filter_clause:
            raise ValueError("Invalid or unsupported filter")

        query = text(f"""
            DELETE FROM "{table_name}"
            WHERE {filter_clause}
        """)

        result = await self.db.execute(query, filter_params)
        return {"count": result.rowcount}

    def _build_response(self, results: dict) -> str:
        """Build WFS TransactionResponse XML."""
        nsmap = {
            "wfs": NAMESPACES["wfs"],
            "ogc": NAMESPACES["ogc"],
        }

        root = etree.Element(
            ns_tag("wfs", "TransactionResponse"),
            nsmap=nsmap,
            version="1.1.0",
        )

        # Transaction summary
        summary = etree.SubElement(root, ns_tag("wfs", "TransactionSummary"))

        total_inserted = etree.SubElement(summary, ns_tag("wfs", "totalInserted"))
        total_inserted.text = str(results["totalInserted"])

        total_updated = etree.SubElement(summary, ns_tag("wfs", "totalUpdated"))
        total_updated.text = str(results["totalUpdated"])

        total_deleted = etree.SubElement(summary, ns_tag("wfs", "totalDeleted"))
        total_deleted.text = str(results["totalDeleted"])

        # Inserted feature IDs
        if results["insertedFeatureIds"]:
            insert_results = etree.SubElement(root, ns_tag("wfs", "InsertResults"))
            for fid in results["insertedFeatureIds"]:
                feature = etree.SubElement(insert_results, ns_tag("wfs", "Feature"))
                fid_elem = etree.SubElement(feature, ns_tag("ogc", "FeatureId"))
                fid_elem.set("fid", fid)

        # Transaction result
        result = etree.SubElement(root, ns_tag("wfs", "TransactionResult"))
        status = etree.SubElement(result, ns_tag("wfs", "Status"))
        success = etree.SubElement(status, ns_tag("wfs", "SUCCESS"))

        return to_xml_string(root)
