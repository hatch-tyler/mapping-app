import asyncio
import json
import logging
import math
import uuid
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import geopandas as gpd
import rasterio
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.config import settings
from app.database import AsyncSessionLocal

logger = logging.getLogger(__name__)


from app.utils.sql_validation import validate_table_name as _validate_table_name


def _serialize_properties(row: Any) -> dict[str, Any]:
    """Serialize a GeoDataFrame row's properties to JSON-safe dict."""
    properties: dict[str, Any] = {}
    for k, v in row.drop("geometry").to_dict().items():
        if v is None:
            properties[k] = None
        elif isinstance(v, float) and math.isnan(v):
            properties[k] = None
        elif hasattr(v, "isoformat"):  # datetime, Timestamp, etc.
            properties[k] = v.isoformat()
        elif hasattr(v, "item"):  # numpy types
            properties[k] = v.item()
        else:
            properties[k] = v
    return properties


class FileProcessor:
    SUPPORTED_VECTOR = {".geojson", ".json", ".shp", ".gpkg", ".zip"}
    SUPPORTED_RASTER = {
        ".tif",
        ".tiff",
        ".geotiff",
        ".jp2",
        ".img",
        ".asc",
        ".bil",
        ".bip",
        ".bsq",
        ".flt",
    }

    @staticmethod
    def get_file_extension(filename: str) -> str:
        return Path(filename).suffix.lower()

    @staticmethod
    def is_vector_file(filename: str) -> bool:
        ext = FileProcessor.get_file_extension(filename)
        return ext in FileProcessor.SUPPORTED_VECTOR

    @staticmethod
    def is_raster_file(filename: str) -> bool:
        ext = FileProcessor.get_file_extension(filename)
        return ext in FileProcessor.SUPPORTED_RASTER

    async def process_vector(
        self,
        file_path: Path,
        dataset_id: uuid.UUID,
        db: AsyncSession,
    ) -> dict[str, Any]:
        # Read file with geopandas
        gdf = gpd.read_file(str(file_path))

        if gdf.empty:
            raise ValueError("File contains no features")

        # Reproject to WGS84 if needed
        if gdf.crs and gdf.crs.to_epsg() != 4326:
            gdf = gdf.to_crs(epsg=4326)
        elif gdf.crs is None:
            # Assume WGS84 if no CRS
            gdf = gdf.set_crs(epsg=4326)

        # Strip Z coordinates if present (PostGIS column is 2D)
        if gdf.geometry.has_z.any():
            from shapely.ops import transform

            gdf["geometry"] = gdf.geometry.apply(
                lambda geom: (
                    transform(lambda x, y, z=None: (x, y), geom)
                    if geom and geom.has_z
                    else geom
                )
            )

        # Get geometry type
        geom_types = gdf.geometry.geom_type.unique()
        geom_type = geom_types[0] if len(geom_types) == 1 else "Geometry"

        # Calculate bounds
        bounds = gdf.total_bounds.tolist()  # [minx, miny, maxx, maxy]

        # Create table name
        table_name = f"vector_data_{str(dataset_id).replace('-', '_')}"

        # Create table
        await self._create_vector_table(db, table_name)

        # Insert features
        await self._insert_features(db, table_name, gdf)

        metadata = {
            "crs": str(gdf.crs) if gdf.crs else None,
            "crs_epsg": gdf.crs.to_epsg() if gdf.crs else None,
            "field_count": len([c for c in gdf.columns if c != "geometry"]),
            "fields": [
                {"name": c, "dtype": str(gdf[c].dtype)}
                for c in gdf.columns
                if c != "geometry"
            ],
        }

        # Additional metadata
        metadata["total_features"] = len(gdf)
        metadata["total_bounds"] = gdf.total_bounds.tolist()
        metadata["geometry_types"] = gdf.geometry.geom_type.unique().tolist()

        # GeoPackage embedded metadata
        if str(file_path).lower().endswith(".gpkg"):
            try:
                import sqlite3

                conn = sqlite3.connect(str(file_path))
                try:
                    cursor = conn.execute(
                        "SELECT md_scope, metadata FROM gpkg_metadata LIMIT 1"
                    )
                    row = cursor.fetchone()
                    if row:
                        metadata["gpkg_metadata_scope"] = row[0]
                        metadata["gpkg_metadata"] = row[1][:5000]
                except sqlite3.OperationalError:
                    pass  # Table doesn't exist
                finally:
                    conn.close()
            except Exception:
                pass

        # Shapefile companion XML metadata
        import glob as _glob

        xml_files = _glob.glob(str(file_path.parent / "*.xml"))
        if xml_files:
            try:
                with open(xml_files[0], "r", errors="ignore") as xf:
                    xml_content = xf.read()[:10000]
                metadata["metadata_xml_source"] = xml_files[0].split("/")[-1]
                # Try to extract key fields from FGDC XML
                try:
                    from xml.etree import ElementTree as ET

                    root = ET.fromstring(xml_content)
                    # FGDC abstract
                    abstract = root.find(".//abstract")
                    if abstract is not None and abstract.text:
                        metadata["abstract"] = abstract.text[:2000]
                    # FGDC purpose
                    purpose = root.find(".//purpose")
                    if purpose is not None and purpose.text:
                        metadata["purpose"] = purpose.text[:2000]
                    # FGDC origin (publisher)
                    origin = root.find(".//origin")
                    if origin is not None and origin.text:
                        metadata["origin"] = origin.text[:500]
                except ET.ParseError:
                    metadata["metadata_xml"] = xml_content[:3000]
            except Exception:
                pass

        return {
            "geometry_type": geom_type,
            "feature_count": len(gdf),
            "bounds": bounds,
            "table_name": table_name,
            "columns": [col for col in gdf.columns if col != "geometry"],
            "metadata": metadata,
        }

    async def _create_vector_table(self, db: AsyncSession, table_name: str) -> None:
        # Validate table name to prevent SQL injection
        if not _validate_table_name(table_name):
            raise ValueError(f"Invalid table name: {table_name}")

        create_sql = f"""
            CREATE TABLE IF NOT EXISTS "{table_name}" (
                id SERIAL PRIMARY KEY,
                geom GEOMETRY(Geometry, 4326),
                properties JSONB,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        """
        await db.execute(text(create_sql))

        # Create spatial index
        index_sql = f"""
            CREATE INDEX IF NOT EXISTS "idx_{table_name}_geom"
            ON "{table_name}" USING GIST(geom)
        """
        await db.execute(text(index_sql))
        await db.commit()

    async def _insert_features(
        self, db: AsyncSession, table_name: str, gdf: gpd.GeoDataFrame
    ) -> None:
        # Validate table name
        if not _validate_table_name(table_name):
            raise ValueError(f"Invalid table name: {table_name}")

        for _, row in gdf.iterrows():
            geom_wkt = row.geometry.wkt
            properties = _serialize_properties(row)

            # Use bindparam style for SQLAlchemy text() with asyncpg
            insert_sql = text(f"""
                INSERT INTO "{table_name}" (geom, properties)
                VALUES (ST_GeomFromText(:geom, 4326), CAST(:properties AS jsonb))
            """)
            await db.execute(
                insert_sql,
                {"geom": geom_wkt, "properties": json.dumps(properties)},
            )

        await db.commit()

    async def _insert_features_batched(
        self,
        db: AsyncSession,
        table_name: str,
        gdf: gpd.GeoDataFrame,
        job_id: uuid.UUID | None = None,
        batch_size: int = 500,
    ) -> None:
        """Insert features in multi-row batches for performance."""
        if not _validate_table_name(table_name):
            raise ValueError(f"Invalid table name: {table_name}")

        total = len(gdf)
        rows = list(gdf.iterrows())

        for batch_start in range(0, total, batch_size):
            batch_end = min(batch_start + batch_size, total)
            batch = rows[batch_start:batch_end]

            # Build multi-row INSERT
            value_clauses = []
            params: dict[str, Any] = {}
            for i, (_, row) in enumerate(batch):
                geom_wkt = row.geometry.wkt
                properties = _serialize_properties(row)
                params[f"g{i}"] = geom_wkt
                params[f"p{i}"] = json.dumps(properties)
                value_clauses.append(
                    f"(ST_GeomFromText(:g{i}, 4326), CAST(:p{i} AS jsonb))"
                )

            insert_sql = text(
                f'INSERT INTO "{table_name}" (geom, properties) VALUES '
                + ", ".join(value_clauses)
            )
            await db.execute(insert_sql, params)
            await db.commit()

            # Update job progress (5% to 95% range for insert phase)
            if job_id is not None:
                progress = 5 + int((batch_end / total) * 90)
                try:
                    from app.crud import dataset as dataset_crud

                    job = await dataset_crud.get_upload_job(db, job_id)
                    if job:
                        await dataset_crud.update_upload_job(db, job, progress=progress)
                except Exception:
                    pass  # Don't fail inserts over progress updates

    async def process_vector_background(
        self,
        file_path: Path,
        dataset_id: uuid.UUID,
        job_id: uuid.UUID,
    ) -> None:
        """Background vector processing with its own DB session."""
        async with AsyncSessionLocal() as db:
            try:
                from app.crud import dataset as dataset_crud

                # Mark job as processing
                job = await dataset_crud.get_upload_job(db, job_id)
                if job:
                    await dataset_crud.update_upload_job(
                        db, job, status="processing", progress=5
                    )

                # Validate shapefile ZIP contents before reading
                crs_warning = None
                if str(file_path).lower().endswith(".zip"):
                    import zipfile

                    with zipfile.ZipFile(str(file_path), "r") as zf:
                        names_lower = [n.lower() for n in zf.namelist()]
                        has_shp = any(n.endswith(".shp") for n in names_lower)
                        if has_shp:
                            has_shx = any(n.endswith(".shx") for n in names_lower)
                            has_dbf = any(n.endswith(".dbf") for n in names_lower)
                            has_prj = any(n.endswith(".prj") for n in names_lower)
                            missing = []
                            if not has_shx:
                                missing.append(".shx")
                            if not has_dbf:
                                missing.append(".dbf")
                            if missing:
                                raise ValueError(
                                    f"Shapefile ZIP is missing required files: "
                                    f"{', '.join(missing)}. A valid shapefile "
                                    f"requires .shp, .shx, and .dbf files."
                                )
                            if not has_prj:
                                crs_warning = (
                                    "Shapefile is missing .prj file. Data will be "
                                    "assumed to be in WGS84 (EPSG:4326) which may "
                                    "cause misalignment if the actual projection differs."
                                )
                                logger.warning(
                                    "Shapefile ZIP %s missing .prj file", file_path
                                )

                # Read file in thread pool to avoid blocking event loop
                gdf = await asyncio.to_thread(gpd.read_file, str(file_path))

                if gdf.empty:
                    raise ValueError("File contains no features")

                # Reproject to WGS84 if needed
                if gdf.crs and gdf.crs.to_epsg() != 4326:
                    gdf = gdf.to_crs(epsg=4326)
                elif gdf.crs is None:
                    gdf = gdf.set_crs(epsg=4326)

                # Strip Z coordinates if present (PostGIS column is 2D)
                if gdf.geometry.has_z.any():
                    from shapely.ops import transform

                    gdf["geometry"] = gdf.geometry.apply(
                        lambda geom: (
                            transform(lambda x, y, z=None: (x, y), geom)
                            if geom and geom.has_z
                            else geom
                        )
                    )

                geom_types = gdf.geometry.geom_type.unique()
                geom_type = geom_types[0] if len(geom_types) == 1 else "Geometry"
                _bounds = gdf.total_bounds.tolist()
                table_name = f"vector_data_{str(dataset_id).replace('-', '_')}"

                await self._create_vector_table(db, table_name)
                await self._insert_features_batched(db, table_name, gdf, job_id=job_id)

                # Extract file metadata
                file_metadata = {
                    "crs": str(gdf.crs) if gdf.crs else None,
                    "crs_epsg": gdf.crs.to_epsg() if gdf.crs else None,
                    "field_count": len([c for c in gdf.columns if c != "geometry"]),
                    "fields": [
                        {"name": c, "dtype": str(gdf[c].dtype)}
                        for c in gdf.columns
                        if c != "geometry"
                    ],
                }

                # Additional metadata
                file_metadata["total_features"] = len(gdf)
                file_metadata["total_bounds"] = gdf.total_bounds.tolist()
                file_metadata["geometry_types"] = (
                    gdf.geometry.geom_type.unique().tolist()
                )

                # GeoPackage embedded metadata
                if str(file_path).lower().endswith(".gpkg"):
                    try:
                        import sqlite3

                        conn = sqlite3.connect(str(file_path))
                        try:
                            cursor = conn.execute(
                                "SELECT md_scope, metadata FROM gpkg_metadata LIMIT 1"
                            )
                            row = cursor.fetchone()
                            if row:
                                file_metadata["gpkg_metadata_scope"] = row[0]
                                file_metadata["gpkg_metadata"] = row[1][:5000]
                        except sqlite3.OperationalError:
                            pass  # Table doesn't exist
                        finally:
                            conn.close()
                    except Exception:
                        pass

                # Shapefile companion XML metadata
                import glob as _glob

                xml_files = _glob.glob(str(file_path.parent / "*.xml"))
                if xml_files:
                    try:
                        with open(xml_files[0], "r", errors="ignore") as xf:
                            xml_content = xf.read()[:10000]
                        file_metadata["metadata_xml_source"] = xml_files[0].split("/")[
                            -1
                        ]
                        # Try to extract key fields from FGDC XML
                        try:
                            from xml.etree import ElementTree as ET

                            root = ET.fromstring(xml_content)
                            # FGDC abstract
                            abstract = root.find(".//abstract")
                            if abstract is not None and abstract.text:
                                file_metadata["abstract"] = abstract.text[:2000]
                            # FGDC purpose
                            purpose = root.find(".//purpose")
                            if purpose is not None and purpose.text:
                                file_metadata["purpose"] = purpose.text[:2000]
                            # FGDC origin (publisher)
                            origin = root.find(".//origin")
                            if origin is not None and origin.text:
                                file_metadata["origin"] = origin.text[:500]
                        except ET.ParseError:
                            file_metadata["metadata_xml"] = xml_content[:3000]
                    except Exception:
                        pass

                # Update dataset with results
                dataset = await dataset_crud.get_dataset(db, dataset_id)
                if dataset:
                    dataset.geometry_type = geom_type
                    dataset.feature_count = len(gdf)
                    dataset.table_name = table_name
                    dataset.service_metadata = file_metadata
                    await db.commit()

                # Mark job completed
                job_kwargs: dict[str, Any] = {
                    "status": "completed",
                    "progress": 100,
                    "completed_at": datetime.now(timezone.utc),
                }
                if crs_warning:
                    job_kwargs["error_message"] = crs_warning
                job = await dataset_crud.get_upload_job(db, job_id)
                if job:
                    await dataset_crud.update_upload_job(db, job, **job_kwargs)

                logger.info(
                    "Background vector processing completed: dataset=%s features=%d",
                    dataset_id,
                    len(gdf),
                )

            except Exception as e:
                logger.exception(
                    "Background vector processing failed: dataset=%s error=%s",
                    dataset_id,
                    str(e),
                )
                # Use a fresh session to mark failure in case the current one is broken
                async with AsyncSessionLocal() as err_db:
                    try:
                        from app.crud import dataset as dataset_crud

                        job = await dataset_crud.get_upload_job(err_db, job_id)
                        if job:
                            await dataset_crud.update_upload_job(
                                err_db,
                                job,
                                status="failed",
                                error_message=str(e)[:1000],
                            )

                        # Clean up orphaned dataset if no table was created
                        dataset = await dataset_crud.get_dataset(err_db, dataset_id)
                        if dataset and not dataset.table_name:
                            await dataset_crud.delete_dataset(err_db, dataset)
                            logger.info(
                                "Deleted orphaned dataset %s after processing failure",
                                dataset_id,
                            )
                    except Exception:
                        logger.exception("Failed to mark upload job as failed")

            finally:
                # Clean up temp directory
                parent = file_path.parent
                try:
                    shutil.rmtree(str(parent))
                except Exception as cleanup_err:
                    logger.warning(
                        "Failed to clean up processing dir %s: %s", parent, cleanup_err
                    )

    async def process_raster_background(
        self,
        file_path: Path,
        dataset_id: uuid.UUID,
        job_id: uuid.UUID,
    ) -> None:
        """Background raster processing with its own DB session."""
        async with AsyncSessionLocal() as db:
            try:
                from app.crud import dataset as dataset_crud

                job = await dataset_crud.get_upload_job(db, job_id)
                if job:
                    await dataset_crud.update_upload_job(
                        db, job, status="processing", progress=10
                    )

                result = await asyncio.to_thread(
                    self._process_raster_sync, file_path, dataset_id
                )

                # Update dataset with file path and raster metadata
                dataset = await dataset_crud.get_dataset(db, dataset_id)
                if dataset:
                    dataset.file_path = result["file_path"]
                    dataset.service_metadata = result.get("metadata", {})
                    # Store WGS84 bounds for map display
                    bounds = result.get("bounds_wgs84")
                    if bounds and len(bounds) == 4:
                        from geoalchemy2.shape import from_shape
                        from shapely.geometry import box

                        dataset.bounds = from_shape(
                            box(bounds[0], bounds[1], bounds[2], bounds[3]),
                            srid=4326,
                        )
                    await db.commit()

                # Build job completion message
                job_kwargs: dict[str, Any] = {
                    "status": "completed",
                    "progress": 100,
                    "completed_at": datetime.now(timezone.utc),
                }
                if result.get("crs_warning"):
                    job_kwargs["error_message"] = result["crs_warning"]

                job = await dataset_crud.get_upload_job(db, job_id)
                if job:
                    await dataset_crud.update_upload_job(db, job, **job_kwargs)

                logger.info(
                    "Background raster processing completed: dataset=%s", dataset_id
                )

            except Exception as e:
                logger.exception(
                    "Background raster processing failed: dataset=%s error=%s",
                    dataset_id,
                    str(e),
                )
                async with AsyncSessionLocal() as err_db:
                    try:
                        from app.crud import dataset as dataset_crud

                        job = await dataset_crud.get_upload_job(err_db, job_id)
                        if job:
                            await dataset_crud.update_upload_job(
                                err_db,
                                job,
                                status="failed",
                                error_message=str(e)[:1000],
                            )
                    except Exception:
                        logger.exception("Failed to mark upload job as failed")

            finally:
                parent = file_path.parent
                try:
                    shutil.rmtree(str(parent))
                except Exception as cleanup_err:
                    logger.warning(
                        "Failed to clean up processing dir %s: %s", parent, cleanup_err
                    )

    async def process_raster(
        self,
        file_path: Path,
        dataset_id: uuid.UUID,
    ) -> dict[str, Any]:
        # Run blocking I/O in a thread pool to avoid blocking the event loop
        return await asyncio.to_thread(self._process_raster_sync, file_path, dataset_id)

    def _extract_raster_from_zip(self, zip_path: Path) -> Path:
        """Extract a ZIP archive and return the path to the primary raster file."""
        import zipfile

        extract_dir = zip_path.parent / "extracted"
        extract_dir.mkdir(exist_ok=True)

        with zipfile.ZipFile(str(zip_path), "r") as zf:
            zf.extractall(str(extract_dir))

        # Find the primary raster file by extension
        raster_extensions = {e for e in self.SUPPORTED_RASTER}
        for f in extract_dir.rglob("*"):
            if f.suffix.lower() in raster_extensions and not f.name.startswith("."):
                return f

        raise ValueError(
            "ZIP archive does not contain a supported raster file. "
            f"Supported: {', '.join(sorted(raster_extensions))}"
        )

    def _process_raster_sync(
        self,
        file_path: Path,
        dataset_id: uuid.UUID,
    ) -> dict[str, Any]:
        """Synchronous raster processing (runs in thread pool).

        Converts uploaded rasters to Cloud Optimized GeoTIFF (COG) for
        efficient tile serving via rio-tiler.
        """
        from pyproj import Transformer

        # Handle ZIP archives
        if file_path.suffix.lower() == ".zip":
            file_path = self._extract_raster_from_zip(file_path)

        output_dir = Path(settings.RASTER_DIR)
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / f"{dataset_id}.tif"

        metadata: dict[str, Any] = {}
        crs_warning = None

        with rasterio.open(str(file_path)) as src:
            original_crs = src.crs
            metadata["original_crs"] = str(original_crs) if original_crs else None
            metadata["band_count"] = src.count
            metadata["dtypes"] = list(src.dtypes)
            metadata["nodata"] = src.nodata
            metadata["width"] = src.width
            metadata["height"] = src.height

            # Extract colormap if present (classified rasters)
            try:
                cmap = src.colormap(1)
                if cmap:
                    metadata["colormap"] = {str(k): list(v) for k, v in cmap.items()}
            except ValueError:
                pass

            if original_crs is None:
                crs_warning = (
                    "No coordinate reference system found in the raster file. "
                    "Data will be assumed to be in WGS84 (EPSG:4326) which may "
                    "cause misalignment if the actual projection differs."
                )
                metadata["crs_missing"] = True
                logger.warning("Raster %s has no CRS, assuming EPSG:4326", dataset_id)
                # Copy as-is, assume 4326
                shutil.copy(str(file_path), str(output_path))
                bounds_wgs84 = list(src.bounds)
            else:
                # Reproject bounds to WGS84 for storage
                if original_crs.to_epsg() != 4326:
                    transformer = Transformer.from_crs(
                        original_crs, "EPSG:4326", always_xy=True
                    )
                    left, bottom = transformer.transform(
                        src.bounds.left, src.bounds.bottom
                    )
                    right, top = transformer.transform(src.bounds.right, src.bounds.top)
                    bounds_wgs84 = [left, bottom, right, top]
                else:
                    bounds_wgs84 = list(src.bounds)

                # Convert to COG (Cloud Optimized GeoTIFF) for efficient tile serving
                # Write with internal tiling and overviews
                profile = src.profile.copy()
                profile.update(
                    driver="GTiff",
                    tiled=True,
                    blockxsize=512,
                    blockysize=512,
                    compress="deflate",
                    predictor=2 if src.dtypes[0].startswith("float") else 1,
                )

                with rasterio.open(str(output_path), "w", **profile) as dst:
                    for band_idx in range(1, src.count + 1):
                        data = src.read(band_idx)
                        dst.write(data, band_idx)

                    # Copy colormap if present
                    try:
                        cmap = src.colormap(1)
                        if cmap:
                            dst.write_colormap(1, cmap)
                    except ValueError:
                        pass

                # Build overviews for faster tile serving at low zoom levels
                try:
                    with rasterio.open(str(output_path), "r+") as dst:
                        from rasterio.enums import Resampling as RasterResampling

                        overview_levels = [2, 4, 8, 16]
                        dst.build_overviews(overview_levels, RasterResampling.nearest)
                        dst.update_tags(ns="rio_overview", resampling="nearest")
                except Exception:
                    logger.debug("Could not build overviews for %s", output_path)

        result = {
            "file_path": str(output_path),
            "bounds_wgs84": bounds_wgs84,
            "metadata": metadata,
        }
        if crs_warning:
            result["crs_warning"] = crs_warning

        return result


file_processor = FileProcessor()
