"""Export endpoints for downloading datasets in various formats."""

import csv
import io
import json
import os
import re
import tempfile
import zipfile
from uuid import UUID

import geopandas as gpd
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.crud.dataset import get_dataset, get_features_by_ids
from app.schemas.dataset import ExportSelectedRequest
from app.api.deps import get_optional_current_user
from app.models.user import User

router = APIRouter(prefix="/export", tags=["export"])


async def get_geodataframe(db: AsyncSession, dataset_id: UUID) -> gpd.GeoDataFrame:
    """Fetch dataset from PostGIS and return as GeoDataFrame."""
    dataset = await get_dataset(db, dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    if dataset.data_type != "vector":
        raise HTTPException(
            status_code=400, detail="Export only available for vector datasets"
        )

    if not dataset.table_name:
        raise HTTPException(status_code=400, detail="Dataset has no associated table")

    # Validate table name to prevent SQL injection
    if not re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", dataset.table_name):
        raise HTTPException(status_code=400, detail="Invalid table configuration")

    # Query data from PostGIS
    query = text(f"""
        SELECT
            id,
            ST_AsText(geom) as geometry,
            properties
        FROM "{dataset.table_name}"
    """)

    result = await db.execute(query)
    rows = result.fetchall()

    if not rows:
        raise HTTPException(status_code=404, detail="No features found in dataset")

    # Build GeoDataFrame
    from shapely import wkt

    features = []
    for row in rows:
        geom = wkt.loads(row[1]) if row[1] else None
        props = row[2] if row[2] else {}
        props["id"] = row[0]
        features.append({"geometry": geom, **props})

    gdf = gpd.GeoDataFrame(features, crs="EPSG:4326")

    return gdf, dataset.name


def sanitize_filename(name: str) -> str:
    """Sanitize filename for safe downloads."""
    # Remove or replace unsafe characters
    name = re.sub(r'[<>:"/\\|?*]', "_", name)
    name = re.sub(r"\s+", "_", name)
    return name[:100]  # Limit length


@router.get("/{dataset_id}/geojson")
async def export_geojson(
    dataset_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Export dataset as GeoJSON file."""
    gdf, name = await get_geodataframe(db, dataset_id)

    # Convert to GeoJSON
    geojson_str = gdf.to_json()

    filename = f"{sanitize_filename(name)}.geojson"

    return StreamingResponse(
        io.BytesIO(geojson_str.encode("utf-8")),
        media_type="application/geo+json",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Access-Control-Allow-Origin": "*",
        },
    )


@router.get("/{dataset_id}/gpkg")
async def export_geopackage(
    dataset_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Export dataset as GeoPackage file."""
    gdf, name = await get_geodataframe(db, dataset_id)

    # Write to temporary file
    with tempfile.NamedTemporaryFile(suffix=".gpkg", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        gdf.to_file(tmp_path, driver="GPKG", layer=sanitize_filename(name))

        # Read the file
        with open(tmp_path, "rb") as f:
            content = f.read()

        filename = f"{sanitize_filename(name)}.gpkg"

        return StreamingResponse(
            io.BytesIO(content),
            media_type="application/geopackage+sqlite3",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Access-Control-Allow-Origin": "*",
            },
        )
    finally:
        # Clean up temp file
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


@router.get("/{dataset_id}/shp")
async def export_shapefile(
    dataset_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Export dataset as Shapefile (zipped)."""
    gdf, name = await get_geodataframe(db, dataset_id)

    safe_name = sanitize_filename(name)

    # Create temporary directory for shapefile components
    with tempfile.TemporaryDirectory() as tmp_dir:
        shp_path = os.path.join(tmp_dir, f"{safe_name}.shp")

        # Shapefile has 10-char field name limit - truncate long names
        gdf_copy = gdf.copy()
        rename_map = {}
        for col in gdf_copy.columns:
            if col != "geometry" and len(col) > 10:
                new_name = col[:10]
                # Handle duplicates
                counter = 1
                while new_name in rename_map.values():
                    new_name = col[:8] + str(counter)
                    counter += 1
                rename_map[col] = new_name

        if rename_map:
            gdf_copy = gdf_copy.rename(columns=rename_map)

        gdf_copy.to_file(shp_path, driver="ESRI Shapefile")

        # Create zip file in memory
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            for ext in [".shp", ".shx", ".dbf", ".prj", ".cpg"]:
                filepath = os.path.join(tmp_dir, f"{safe_name}{ext}")
                if os.path.exists(filepath):
                    zf.write(filepath, f"{safe_name}{ext}")

        zip_buffer.seek(0)

        filename = f"{safe_name}.zip"

        return StreamingResponse(
            zip_buffer,
            media_type="application/zip",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Access-Control-Allow-Origin": "*",
            },
        )


@router.get("/{dataset_id}/kml")
async def export_kml(
    dataset_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Export dataset as KML file."""
    gdf, name = await get_geodataframe(db, dataset_id)

    # Write to temporary file (fiona/GDAL handles KML)
    with tempfile.NamedTemporaryFile(suffix=".kml", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        # KML requires WGS84
        if gdf.crs and gdf.crs.to_epsg() != 4326:
            gdf = gdf.to_crs(epsg=4326)

        gdf.to_file(tmp_path, driver="KML")

        # Read the file
        with open(tmp_path, "rb") as f:
            content = f.read()

        filename = f"{sanitize_filename(name)}.kml"

        return StreamingResponse(
            io.BytesIO(content),
            media_type="application/vnd.google-earth.kml+xml",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Access-Control-Allow-Origin": "*",
            },
        )
    finally:
        # Clean up temp file
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


@router.post("/{dataset_id}/selected")
async def export_selected_features(
    dataset_id: UUID,
    request: ExportSelectedRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = Depends(get_optional_current_user),
):
    """Export selected features as CSV or GeoJSON.

    Access control: public datasets or authenticated user.
    """
    dataset = await get_dataset(db, dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    # Access control
    if not dataset.is_public and current_user is None:
        raise HTTPException(status_code=403, detail="Dataset is not public")

    if dataset.data_type != "vector":
        raise HTTPException(
            status_code=400, detail="Export only available for vector datasets"
        )

    if not request.feature_ids:
        raise HTTPException(status_code=400, detail="No features selected")

    include_geometry = request.format.lower() == "geojson"
    features = await get_features_by_ids(
        db, dataset, request.feature_ids, include_geometry
    )

    if not features:
        raise HTTPException(status_code=404, detail="No features found")

    safe_name = sanitize_filename(dataset.name)

    if request.format.lower() == "csv":
        # Build CSV
        output = io.StringIO()

        # Collect all property keys
        all_keys = set()
        for f in features:
            all_keys.update(f["properties"].keys())
        all_keys = sorted(all_keys)

        fieldnames = ["id"] + list(all_keys)
        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()

        for f in features:
            row = {"id": f["id"]}
            for key in all_keys:
                row[key] = f["properties"].get(key, "")
            writer.writerow(row)

        content = output.getvalue()
        filename = f"{safe_name}_selected.csv"

        return StreamingResponse(
            io.BytesIO(content.encode("utf-8")),
            media_type="text/csv",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Access-Control-Allow-Origin": "*",
            },
        )

    elif request.format.lower() == "geojson":
        # Build GeoJSON FeatureCollection
        geojson_features = []
        for f in features:
            geojson_features.append(
                {
                    "type": "Feature",
                    "id": f["id"],
                    "geometry": f.get("geometry"),
                    "properties": f["properties"],
                }
            )

        geojson = {
            "type": "FeatureCollection",
            "features": geojson_features,
        }

        content = json.dumps(geojson, indent=2)
        filename = f"{safe_name}_selected.geojson"

        return StreamingResponse(
            io.BytesIO(content.encode("utf-8")),
            media_type="application/geo+json",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Access-Control-Allow-Origin": "*",
            },
        )

    else:
        raise HTTPException(
            status_code=400, detail="Unsupported format. Use 'csv' or 'geojson'"
        )


@router.get("/external/{dataset_id}/{format}")
async def export_external_dataset(
    dataset_id: UUID,
    format: str,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = Depends(get_optional_current_user),
):
    """Export an external vector dataset by fetching features from the remote service.

    Supported formats: geojson, gpkg, shp, kml
    Features are fetched with pagination, capped at 10,000 features.
    """
    from app.services.external_source import fetch_all_features
    from shapely.geometry import shape

    if format not in ("geojson", "gpkg", "shp", "kml"):
        raise HTTPException(status_code=400, detail="Unsupported format")

    dataset = await get_dataset(db, dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    if dataset.source_type != "external":
        raise HTTPException(status_code=400, detail="Not an external dataset")

    if dataset.service_type not in ("arcgis_feature", "wfs"):
        raise HTTPException(
            status_code=400, detail="Export only available for vector external sources"
        )

    # Access control
    if not dataset.is_public and current_user is None:
        raise HTTPException(status_code=403, detail="Dataset is not public")

    # Fetch all features from the external service
    geojson_data = await fetch_all_features(
        service_url=dataset.service_url,
        service_type=dataset.service_type,
        layer_id=dataset.service_layer_id or "0",
        max_features=10000,
    )

    features = geojson_data.get("features", [])
    if not features:
        raise HTTPException(
            status_code=404, detail="No features returned from external service"
        )

    name = re.sub(r"[^\w\s-]", "", dataset.name)[:64].strip() or "export"
    safe_name = name.replace(" ", "_")

    # GeoJSON: return directly
    if format == "geojson":
        content = json.dumps(geojson_data, indent=2)
        return StreamingResponse(
            io.BytesIO(content.encode("utf-8")),
            media_type="application/geo+json",
            headers={
                "Content-Disposition": f'attachment; filename="{safe_name}.geojson"',
                "Access-Control-Allow-Origin": "*",
            },
        )

    # Build GeoDataFrame for other formats
    rows = []
    geometries = []
    for feat in features:
        props = feat.get("properties", {}) or {}
        geom = feat.get("geometry")
        if geom:
            try:
                geometries.append(shape(geom))
                rows.append(props)
            except Exception:
                continue

    if not rows:
        raise HTTPException(status_code=400, detail="No valid features to export")

    gdf = gpd.GeoDataFrame(rows, geometry=geometries, crs="EPSG:4326")

    if format == "gpkg":
        tmp_path = tempfile.mktemp(suffix=".gpkg")
        try:
            gdf.to_file(tmp_path, driver="GPKG", layer=safe_name)
            data = open(tmp_path, "rb").read()
            return StreamingResponse(
                io.BytesIO(data),
                media_type="application/geopackage+sqlite3",
                headers={
                    "Content-Disposition": f'attachment; filename="{safe_name}.gpkg"',
                    "Access-Control-Allow-Origin": "*",
                },
            )
        finally:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)

    elif format == "shp":
        tmp_dir = tempfile.mkdtemp()
        shp_path = os.path.join(tmp_dir, f"{safe_name}.shp")
        try:
            # Truncate field names to 10 chars for Shapefile
            rename_map = {}
            seen = set()
            for col in gdf.columns:
                if col == "geometry":
                    continue
                short = col[:10]
                if short in seen:
                    for i in range(1, 100):
                        candidate = f"{col[:8]}{i:02d}"
                        if candidate not in seen:
                            short = candidate
                            break
                seen.add(short)
                if short != col:
                    rename_map[col] = short
            if rename_map:
                gdf = gdf.rename(columns=rename_map)

            gdf.to_file(shp_path, driver="ESRI Shapefile")

            zip_buffer = io.BytesIO()
            with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
                for fname in os.listdir(tmp_dir):
                    fpath = os.path.join(tmp_dir, fname)
                    zf.write(fpath, fname)
            zip_buffer.seek(0)

            return StreamingResponse(
                zip_buffer,
                media_type="application/zip",
                headers={
                    "Content-Disposition": f'attachment; filename="{safe_name}.zip"',
                    "Access-Control-Allow-Origin": "*",
                },
            )
        finally:
            import shutil

            shutil.rmtree(tmp_dir, ignore_errors=True)

    elif format == "kml":
        tmp_path = tempfile.mktemp(suffix=".kml")
        try:
            if gdf.crs and gdf.crs.to_epsg() != 4326:
                gdf = gdf.to_crs(epsg=4326)
            gdf.to_file(tmp_path, driver="KML")
            data = open(tmp_path, "rb").read()
            return StreamingResponse(
                io.BytesIO(data),
                media_type="application/vnd.google-earth.kml+xml",
                headers={
                    "Content-Disposition": f'attachment; filename="{safe_name}.kml"',
                    "Access-Control-Allow-Origin": "*",
                },
            )
        finally:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)


# ===== Style Export Endpoints =====


@router.get("/datasets/{dataset_id}/style/sld")
async def export_style_sld(
    dataset_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = Depends(get_optional_current_user),
):
    """Export dataset style as OGC Styled Layer Descriptor (SLD) XML."""
    from app.services.style_exporter import generate_sld

    dataset = await get_dataset(db, dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    style_config = dataset.style_config or {}
    sld_xml = generate_sld(
        style_config, layer_name=dataset.name, geometry_type=dataset.geometry_type
    )
    safe_name = re.sub(r"[^\w\-.]", "_", dataset.name)

    return StreamingResponse(
        io.BytesIO(sld_xml.encode("utf-8")),
        media_type="application/vnd.ogc.sld+xml",
        headers={
            "Content-Disposition": f'attachment; filename="{safe_name}.sld"',
            "Access-Control-Allow-Origin": "*",
        },
    )


@router.get("/datasets/{dataset_id}/style/lyrx")
async def export_style_lyrx(
    dataset_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = Depends(get_optional_current_user),
):
    """Export dataset style as ArcGIS Pro layer file (.lyrx)."""
    from app.services.style_exporter import generate_lyrx

    dataset = await get_dataset(db, dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    style_config = dataset.style_config or {}
    lyrx_json = generate_lyrx(
        style_config, layer_name=dataset.name, geometry_type=dataset.geometry_type
    )
    safe_name = re.sub(r"[^\w\-.]", "_", dataset.name)

    return StreamingResponse(
        io.BytesIO(lyrx_json.encode("utf-8")),
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="{safe_name}.lyrx"',
            "Access-Control-Allow-Origin": "*",
        },
    )


@router.get("/datasets/{dataset_id}/style/qml")
async def export_style_qml(
    dataset_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = Depends(get_optional_current_user),
):
    """Export dataset style as QGIS style file (.qml)."""
    from app.services.style_exporter import generate_qml

    dataset = await get_dataset(db, dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    style_config = dataset.style_config or {}
    qml_xml = generate_qml(
        style_config, layer_name=dataset.name, geometry_type=dataset.geometry_type
    )
    safe_name = re.sub(r"[^\w\-.]", "_", dataset.name)

    return StreamingResponse(
        io.BytesIO(qml_xml.encode("utf-8")),
        media_type="application/xml",
        headers={
            "Content-Disposition": f'attachment; filename="{safe_name}.qml"',
            "Access-Control-Allow-Origin": "*",
        },
    )
