"""
ESRI Feature Service query handler for PostGIS.
"""

import json
import re
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text, select

from app.models.dataset import Dataset
from app.services.arcgis.esri_json import (
    geojson_to_esri_geometry_type,
    geojson_feature_to_esri,
    python_type_to_esri_field_type,
    build_field_definition,
    build_spatial_reference,
    build_extent,
    build_query_response,
    build_count_response,
    build_ids_response,
)


def slugify(name: str) -> str:
    """Convert dataset name to URL-safe slug."""
    slug = re.sub(r'[^\w\s-]', '', name.lower())
    return re.sub(r'[-\s]+', '_', slug).strip('-_')


class ESRIQueryHandler:
    """Handle ESRI Feature Service queries against PostGIS."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_dataset_by_name(self, service_name: str) -> Dataset | None:
        """Find a public dataset by name or slug."""
        # First try exact match
        result = await self.db.execute(
            select(Dataset).where(
                Dataset.name == service_name,
                Dataset.is_public == True,
                Dataset.data_type == "vector",
            )
        )
        dataset = result.scalar_one_or_none()
        if dataset:
            return dataset

        # Try slug match
        result = await self.db.execute(
            select(Dataset).where(
                Dataset.is_public == True,
                Dataset.data_type == "vector",
            )
        )
        for ds in result.scalars():
            if slugify(ds.name) == service_name:
                return ds

        return None

    async def get_public_datasets(self) -> list[Dataset]:
        """Get all public vector datasets."""
        result = await self.db.execute(
            select(Dataset).where(
                Dataset.is_public == True,
                Dataset.data_type == "vector",
            ).order_by(Dataset.name)
        )
        return list(result.scalars().all())

    async def get_layer_info(self, dataset: Dataset) -> dict:
        """Get layer metadata including fields and extent."""
        table_name = dataset.table_name
        if not table_name or not re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', table_name):
            return {}

        # Get geometry type from a sample row
        geom_type_query = text(f"""
            SELECT ST_GeometryType(geom) as geom_type
            FROM "{table_name}"
            WHERE geom IS NOT NULL
            LIMIT 1
        """)

        result = await self.db.execute(geom_type_query)
        geom_type_row = result.fetchone()

        # Get extent using aggregate function (separate query)
        extent_query = text(f"""
            SELECT
                ST_XMin(ST_Extent(geom)) as xmin,
                ST_YMin(ST_Extent(geom)) as ymin,
                ST_XMax(ST_Extent(geom)) as xmax,
                ST_YMax(ST_Extent(geom)) as ymax
            FROM "{table_name}"
            WHERE geom IS NOT NULL
        """)

        result = await self.db.execute(extent_query)
        extent_row = result.fetchone()

        # Get sample properties for field inference
        props_query = text(f"""
            SELECT properties
            FROM "{table_name}"
            WHERE properties IS NOT NULL
            LIMIT 100
        """)

        result = await self.db.execute(props_query)
        rows = result.fetchall()

        # Infer fields from properties
        # Reserved field names that should not be duplicated
        reserved_fields = {"OBJECTID", "objectid", "FID", "fid", "OID", "oid", "id", "ID"}

        fields = [
            build_field_definition("OBJECTID", "esriFieldTypeOID"),
        ]

        field_types = {}
        for row in rows:
            props = row[0] if row[0] else {}
            for key, value in props.items():
                # Skip reserved field names to avoid duplicates
                if key in reserved_fields:
                    continue
                if key not in field_types:
                    field_types[key] = python_type_to_esri_field_type(value)

        for key, esri_type in field_types.items():
            fields.append(build_field_definition(key, esri_type))

        # Determine geometry type
        geom_type = "esriGeometryPolygon"
        if geom_type_row and geom_type_row[0]:
            pg_geom_type = geom_type_row[0]
            # Map PostGIS type to ESRI
            if "POINT" in pg_geom_type.upper():
                geom_type = "esriGeometryPoint"
            elif "LINE" in pg_geom_type.upper():
                geom_type = "esriGeometryPolyline"
            elif "POLYGON" in pg_geom_type.upper():
                geom_type = "esriGeometryPolygon"

        # Build extent
        extent = build_extent(-180, -90, 180, 90)
        if extent_row and all(extent_row):
            extent = build_extent(
                extent_row[0], extent_row[1], extent_row[2], extent_row[3]
            )

        return {
            "geometry_type": geom_type,
            "fields": fields,
            "extent": extent,
        }

    async def execute_query(
        self,
        dataset: Dataset,
        where: str = "1=1",
        object_ids: str | None = None,
        geometry: str | None = None,
        geometry_type: str | None = None,
        spatial_rel: str = "esriSpatialRelIntersects",
        out_fields: str = "*",
        return_geometry: bool = True,
        out_sr: int = 4326,
        result_offset: int = 0,
        result_record_count: int = 50000,
        return_count_only: bool = False,
        return_ids_only: bool = False,
    ) -> dict:
        """Execute a feature query and return ESRI JSON response."""
        table_name = dataset.table_name
        if not table_name or not re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', table_name):
            return {"error": {"message": "Invalid table configuration"}}

        # Build WHERE clause
        where_clauses = []
        params = {}

        # Object IDs filter
        if object_ids:
            try:
                ids = [int(x.strip()) for x in object_ids.split(",")]
                placeholders = ", ".join([f":oid_{i}" for i in range(len(ids))])
                where_clauses.append(f"id IN ({placeholders})")
                for i, oid in enumerate(ids):
                    params[f"oid_{i}"] = oid
            except ValueError:
                pass

        # Geometry/BBOX filter
        if geometry:
            try:
                geom_obj = json.loads(geometry)
                if "xmin" in geom_obj:
                    # It's an envelope
                    where_clauses.append(
                        "ST_Intersects(geom, ST_MakeEnvelope(:xmin, :ymin, :xmax, :ymax, 4326))"
                    )
                    params.update({
                        "xmin": geom_obj["xmin"],
                        "ymin": geom_obj["ymin"],
                        "xmax": geom_obj["xmax"],
                        "ymax": geom_obj["ymax"],
                    })
            except (json.JSONDecodeError, KeyError):
                pass

        # Build final WHERE
        where_sql = " AND ".join(where_clauses) if where_clauses else "TRUE"

        # Handle count-only
        if return_count_only:
            count_query = text(f"""
                SELECT COUNT(*) FROM "{table_name}" WHERE {where_sql}
            """)
            result = await self.db.execute(count_query, params)
            count = result.scalar() or 0
            return build_count_response(count)

        # Handle IDs-only
        if return_ids_only:
            ids_query = text(f"""
                SELECT id FROM "{table_name}" WHERE {where_sql} ORDER BY id
            """)
            result = await self.db.execute(ids_query, params)
            ids = [row[0] for row in result.fetchall()]
            return build_ids_response(ids)

        # Get layer info for fields and geometry type
        layer_info = await self.get_layer_info(dataset)

        # Build field selection
        if out_fields == "*":
            props_select = "properties"
        else:
            field_list = [f.strip() for f in out_fields.split(",") if f.strip() != "OBJECTID"]
            if field_list:
                props_select = "properties"  # Still fetch all, will filter later
            else:
                props_select = "'{}'::jsonb"

        # Main query
        params["limit"] = min(result_record_count, 50000)  # Cap at 50000
        params["offset"] = result_offset

        geom_select = "ST_AsGeoJSON(geom)::json" if return_geometry else "NULL"

        query = text(f"""
            SELECT
                id,
                {geom_select} as geometry,
                {props_select} as properties
            FROM "{table_name}"
            WHERE {where_sql}
            ORDER BY id
            LIMIT :limit OFFSET :offset
        """)

        result = await self.db.execute(query, params)
        rows = result.fetchall()

        # Convert to ESRI features
        features = []
        for row in rows:
            feature = {
                "type": "Feature",
                "geometry": row[1],
                "properties": row[2] if row[2] else {},
            }
            esri_feature = geojson_feature_to_esri(
                feature,
                object_id=row[0],
                include_geometry=return_geometry,
            )
            features.append(esri_feature)

        # Check if we hit the limit (more records available)
        exceeded_limit = len(features) >= params["limit"]

        return build_query_response(
            features=features,
            fields=layer_info.get("fields", []),
            geometry_type=layer_info.get("geometry_type", "esriGeometryPolygon"),
            exceeded_transfer_limit=exceeded_limit,
        )
