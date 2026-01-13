"""WFS GetFeature implementation."""

import json
import re
from uuid import UUID
from lxml import etree
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text, select

from app.models.dataset import Dataset
from app.services.wfs.xml_builder import (
    NAMESPACES,
    ns_tag,
    to_xml_string,
    geometry_to_gml,
    build_exception_report,
)


class WFSGetFeature:
    """Execute WFS GetFeature requests."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def execute(
        self,
        type_name: str,
        output_format: str = "application/json",
        bbox: str | None = None,
        max_features: int = 1000,
        start_index: int = 0,
        srs_name: str = "EPSG:4326",
        property_names: list[str] | None = None,
        feature_id: str | None = None,
        filter_xml: str | None = None,
        result_type: str = "results",
    ) -> str:
        """Execute GetFeature and return response in requested format."""
        # Parse type name
        dataset_id = self._parse_type_name(type_name)
        if not dataset_id:
            return build_exception_report(
                "InvalidParameterValue",
                f"Invalid typeName: {type_name}",
                "typeName",
            )

        # Get dataset
        stmt = select(Dataset).where(Dataset.id == dataset_id)
        result = await self.db.execute(stmt)
        dataset = result.scalar_one_or_none()

        if not dataset:
            return build_exception_report(
                "InvalidParameterValue",
                f"Feature type not found: {type_name}",
                "typeName",
            )

        if not dataset.is_public:
            return build_exception_report(
                "InvalidParameterValue",
                f"Feature type not accessible: {type_name}",
                "typeName",
            )

        if dataset.data_type != "vector" or not dataset.table_name:
            return build_exception_report(
                "InvalidParameterValue",
                f"Invalid feature type: {type_name}",
                "typeName",
            )

        # Validate table name
        if not re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', dataset.table_name):
            return build_exception_report(
                "OperationProcessingFailed",
                "Invalid table configuration",
            )

        # Execute query
        if result_type == "hits":
            return await self._execute_hits(dataset, bbox, filter_xml, feature_id)

        features = await self._query_features(
            dataset=dataset,
            bbox=bbox,
            max_features=max_features,
            start_index=start_index,
            property_names=property_names,
            feature_id=feature_id,
            filter_xml=filter_xml,
        )

        # Format response
        if "json" in output_format.lower():
            return self._format_geojson(features, dataset)
        else:
            return self._format_gml(features, dataset, srs_name)

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

    async def _execute_hits(
        self,
        dataset: Dataset,
        bbox: str | None,
        filter_xml: str | None,
        feature_id: str | None,
    ) -> str:
        """Execute hits-only query to count features."""
        table_name = dataset.table_name
        where_clauses, params = self._build_where_clause(bbox, filter_xml, feature_id)

        where_sql = " AND ".join(where_clauses) if where_clauses else "TRUE"

        query = text(f"""
            SELECT COUNT(*) as count
            FROM "{table_name}"
            WHERE {where_sql}
        """)

        result = await self.db.execute(query, params)
        count = result.scalar()

        # Return hits response
        nsmap = {"wfs": NAMESPACES["wfs"]}
        root = etree.Element(
            ns_tag("wfs", "FeatureCollection"),
            nsmap=nsmap,
            numberOfFeatures=str(count),
        )
        return to_xml_string(root)

    async def _query_features(
        self,
        dataset: Dataset,
        bbox: str | None,
        max_features: int,
        start_index: int,
        property_names: list[str] | None,
        feature_id: str | None,
        filter_xml: str | None,
    ) -> list[dict]:
        """Query features from database."""
        table_name = dataset.table_name
        where_clauses, params = self._build_where_clause(bbox, filter_xml, feature_id)

        where_sql = " AND ".join(where_clauses) if where_clauses else "TRUE"
        params["limit"] = max_features
        params["offset"] = start_index

        # Build property selection
        if property_names:
            # Select specific properties
            props_select = ", ".join([
                f"properties->>'{p}' as \"{p}\""
                for p in property_names
            ])
            query = text(f"""
                SELECT
                    id,
                    ST_AsGeoJSON(geom)::json as geometry,
                    {props_select}
                FROM "{table_name}"
                WHERE {where_sql}
                ORDER BY id
                LIMIT :limit OFFSET :offset
            """)
        else:
            # Select all properties
            query = text(f"""
                SELECT
                    id,
                    ST_AsGeoJSON(geom)::json as geometry,
                    properties
                FROM "{table_name}"
                WHERE {where_sql}
                ORDER BY id
                LIMIT :limit OFFSET :offset
            """)

        result = await self.db.execute(query, params)
        rows = result.fetchall()

        features = []
        for row in rows:
            if property_names:
                # Reconstruct properties from individual columns
                props = {p: row[i + 2] for i, p in enumerate(property_names)}
            else:
                props = row[2] if row[2] else {}

            features.append({
                "id": row[0],
                "geometry": row[1],
                "properties": props,
            })

        return features

    def _build_where_clause(
        self,
        bbox: str | None,
        filter_xml: str | None,
        feature_id: str | None,
    ) -> tuple[list[str], dict]:
        """Build WHERE clause from parameters."""
        clauses = []
        params = {}

        if bbox:
            try:
                parts = bbox.split(",")
                minx, miny, maxx, maxy = map(float, parts[:4])
                clauses.append(
                    "ST_Intersects(geom, ST_MakeEnvelope(:minx, :miny, :maxx, :maxy, 4326))"
                )
                params.update({
                    "minx": minx,
                    "miny": miny,
                    "maxx": maxx,
                    "maxy": maxy,
                })
            except (ValueError, IndexError):
                pass

        if feature_id:
            try:
                fid = int(feature_id.split(".")[-1])
                clauses.append("id = :fid")
                params["fid"] = fid
            except (ValueError, IndexError):
                pass

        if filter_xml:
            # Parse OGC filter - simplified implementation
            from app.services.wfs.filter_parser import parse_ogc_filter
            filter_clause, filter_params = parse_ogc_filter(filter_xml)
            if filter_clause:
                clauses.append(filter_clause)
                params.update(filter_params)

        return clauses, params

    def _format_geojson(self, features: list[dict], dataset: Dataset) -> str:
        """Format features as GeoJSON."""
        geojson = {
            "type": "FeatureCollection",
            "numberMatched": len(features),
            "numberReturned": len(features),
            "features": [
                {
                    "type": "Feature",
                    "id": f"gis:{dataset.id}.{f['id']}",
                    "geometry": f["geometry"],
                    "properties": f["properties"],
                }
                for f in features
            ],
        }
        return json.dumps(geojson)

    def _format_gml(
        self,
        features: list[dict],
        dataset: Dataset,
        srs_name: str,
    ) -> str:
        """Format features as GML 3.1.1."""
        nsmap = {
            "wfs": NAMESPACES["wfs"],
            "gml": NAMESPACES["gml"],
            "gis": NAMESPACES["gis"],
            "xsi": NAMESPACES["xsi"],
        }

        root = etree.Element(
            ns_tag("wfs", "FeatureCollection"),
            nsmap=nsmap,
        )
        root.set("numberOfFeatures", str(len(features)))
        root.set(
            ns_tag("xsi", "schemaLocation"),
            "http://www.opengis.net/wfs http://schemas.opengis.net/wfs/1.1.0/wfs.xsd "
            "http://www.opengis.net/gml http://schemas.opengis.net/gml/3.1.1/base/gml.xsd"
        )

        # Add boundedBy element (required by some clients like ArcGIS)
        bounded_by = etree.SubElement(root, ns_tag("gml", "boundedBy"))
        null_env = etree.SubElement(bounded_by, ns_tag("gml", "Null"))
        null_env.text = "unknown"

        for f in features:
            member = etree.SubElement(root, ns_tag("gml", "featureMember"))

            feature_name = f"feature_{str(dataset.id).replace('-', '_')}"
            feature_elem = etree.SubElement(member, ns_tag("gis", feature_name))
            # gml:id must be a valid XML ID (no colons, must start with letter)
            feature_elem.set(ns_tag("gml", "id"), f"F{str(dataset.id).replace('-', '_')}_{f['id']}")

            # Add geometry - named "Shape" for ArcGIS compatibility
            if f["geometry"]:
                geom_elem = etree.SubElement(feature_elem, ns_tag("gis", "Shape"))
                gml_geom = geometry_to_gml(f["geometry"], srs_name)
                geom_elem.append(gml_geom)

            # Add properties
            for key, value in f["properties"].items():
                prop_elem = etree.SubElement(feature_elem, ns_tag("gis", key))
                if value is not None:
                    prop_elem.text = str(value)
                else:
                    prop_elem.set(ns_tag("xsi", "nil"), "true")

        return to_xml_string(root)
