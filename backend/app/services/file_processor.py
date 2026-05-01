import asyncio
import json
import logging
import math
import uuid
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

import geopandas as gpd
import rasterio
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.config import settings
from app.database import AsyncSessionLocal
from app.services.upload_errors import UploadError, UploadErrorCode

logger = logging.getLogger(__name__)


from app.utils.sql_validation import validate_table_name as _validate_table_name

# Default features-per-chunk for streaming vector reads. Sized so a chunk
# of complex polygons stays well under ~200 MB even before the per-chunk
# DB insert (which sub-batches at 500 rows). Tunable; not currently
# exposed as a setting because the default has worked across all formats
# the app supports.
_VECTOR_CHUNK_SIZE = 50_000


@dataclass
class VectorChunkInfo:
    """Header info for a vector source, returned before the first chunk read.

    Lets ``process_vector_background`` fail fast on empty files or missing
    CRS without paying the cost of any feature read.
    """

    feature_count: int
    crs: Any  # pyproj.CRS or None; loose typing to avoid an import cycle
    fields: list[dict[str, str]]


def _iter_vector_chunks(
    file_path: Path,
    *,
    layer_name: str | None = None,
    chunk_size: int | None = None,
) -> tuple[VectorChunkInfo, Iterator[gpd.GeoDataFrame]]:
    """Probe a vector source, then return an iterator that yields chunks.

    Streaming reads via ``pyogrio.read_dataframe(rows=slice(start, end))``
    keep peak memory bounded to one chunk at a time, regardless of the
    layer's total feature count. Works for any GDAL/OGR-supported source
    pyogrio handles (shapefile, GeoJSON, GeoPackage, FlatGeobuf,
    OpenFileGDB feature classes, etc.). Driver is auto-detected from the
    path/extension; ``layer_name`` is honoured for multi-layer containers.

    Returns ``(info, chunks)``. ``info.feature_count`` is the total in
    the source; iterating ``chunks`` yields GeoDataFrame slices whose
    sum of lengths equals ``feature_count``. Each chunk preserves the
    source CRS — caller must reproject per-chunk.

    ``chunk_size`` defaults to ``_VECTOR_CHUNK_SIZE`` looked up at call
    time (so tests can ``patch("...._VECTOR_CHUNK_SIZE", N)`` to drive
    the chunking with synthetic small files).
    """
    from pyogrio import read_info, read_dataframe

    if chunk_size is None:
        chunk_size = _VECTOR_CHUNK_SIZE

    info_kwargs: dict[str, Any] = {}
    if layer_name is not None:
        info_kwargs["layer"] = layer_name

    raw_info = read_info(str(file_path), **info_kwargs)

    # pyogrio returns numpy arrays for the schema fields; ``arr or []``
    # raises ``ValueError: truth value of an empty array is ambiguous``.
    # Coerce explicitly via an is-None check to handle both numpy arrays
    # and the (rare) missing-key case.
    _fields = raw_info.get("fields")
    _dtypes = raw_info.get("dtypes")
    info = VectorChunkInfo(
        feature_count=int(raw_info.get("features", 0) or 0),
        crs=raw_info.get("crs"),
        fields=[
            {"name": str(name), "dtype": str(dtype)}
            for name, dtype in zip(
                _fields if _fields is not None else [],
                _dtypes if _dtypes is not None else [],
            )
        ],
    )

    def _chunks() -> Iterator[gpd.GeoDataFrame]:
        if info.feature_count <= 0:
            return
        read_kwargs: dict[str, Any] = {}
        if layer_name is not None:
            read_kwargs["layer"] = layer_name
        for start in range(0, info.feature_count, chunk_size):
            count = min(chunk_size, info.feature_count - start)
            # ``force_2d=True`` strips Z at the GDAL level — faster than
            # post-read Python-side stripping and matches the PostGIS
            # 2D geometry column. ``skip_features``/``max_features`` are
            # the pyogrio-native row-window kwargs (the older "rows="
            # form is geopandas-only and silently ignored here).
            yield read_dataframe(
                str(file_path),
                skip_features=start,
                max_features=count,
                force_2d=True,
                **read_kwargs,
            )

    return info, _chunks()


def _merge_bounds(acc: list[float] | None, chunk_bounds: Any) -> list[float]:
    """Combine a per-chunk total_bounds with the running accumulator.

    ``chunk_bounds`` is a 4-tuple ``[minx, miny, maxx, maxy]`` (numpy
    array from ``GeoDataFrame.total_bounds``).
    """
    cb = [float(x) for x in chunk_bounds]
    if acc is None:
        return cb
    return [
        min(acc[0], cb[0]),
        min(acc[1], cb[1]),
        max(acc[2], cb[2]),
        max(acc[3], cb[3]),
    ]


def _strip_z(geom: Any) -> Any:
    """Return a 2D copy of a possibly-3D shapely geometry.

    PostGIS columns are GEOMETRY(Geometry, 4326) without Z; stripping in
    Python avoids a DB-side cast on every insert. No-op if the geometry
    is None or already 2D.
    """
    if geom is None or not getattr(geom, "has_z", False):
        return geom
    from shapely.ops import transform

    return transform(lambda x, y, z=None: (x, y), geom)


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
    # Multi-layer container formats. Members of these sets are not uploadable
    # as a bare single file via /upload/vector or /upload/raster — they only
    # flow through the bundle path, where each layer becomes its own dataset.
    SUPPORTED_CONTAINER = {".gdb", ".lpk", ".lpkx"}
    # Raster formats that can't be uploaded bare — they need .hdr / .prj
    # sidecars and must arrive in a ZIP.
    SIDECAR_DEPENDENT_RASTER = {".asc", ".bil", ".bip", ".bsq", ".flt"}

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

    @staticmethod
    def _extract_gpkg_metadata(file_path: Path) -> dict[str, Any]:
        """Read embedded metadata from a GeoPackage's gpkg_metadata table, if any.

        Returns a (possibly empty) dict suitable for merging into the dataset
        metadata. All errors are swallowed — embedded metadata is optional.
        """
        if not str(file_path).lower().endswith(".gpkg"):
            return {}
        out: dict[str, Any] = {}
        try:
            import sqlite3

            conn = sqlite3.connect(str(file_path))
            try:
                cursor = conn.execute(
                    "SELECT md_scope, metadata FROM gpkg_metadata LIMIT 1"
                )
                row = cursor.fetchone()
                if row:
                    out["gpkg_metadata_scope"] = row[0]
                    out["gpkg_metadata"] = row[1][:5000]
            except sqlite3.OperationalError:
                pass  # Table doesn't exist
            finally:
                conn.close()
        except Exception:
            pass
        return out

    @staticmethod
    def _extract_fgdc_xml(file_path: Path) -> dict[str, Any]:
        """Read shapefile companion FGDC XML metadata from `file_path`'s directory.

        Returns a dict with any of: ``metadata_xml_source``, ``abstract``,
        ``purpose``, ``origin``, ``metadata_xml``. All errors are swallowed.
        """
        import glob as _glob

        out: dict[str, Any] = {}
        xml_files = _glob.glob(str(file_path.parent / "*.xml"))
        if not xml_files:
            return out
        try:
            with open(xml_files[0], "r", errors="ignore") as xf:
                xml_content = xf.read()[:10000]
            out["metadata_xml_source"] = xml_files[0].split("/")[-1]
            try:
                from xml.etree import ElementTree as ET

                root = ET.fromstring(xml_content)
                abstract = root.find(".//abstract")
                if abstract is not None and abstract.text:
                    out["abstract"] = abstract.text[:2000]
                purpose = root.find(".//purpose")
                if purpose is not None and purpose.text:
                    out["purpose"] = purpose.text[:2000]
                origin = root.find(".//origin")
                if origin is not None and origin.text:
                    out["origin"] = origin.text[:500]
            except ET.ParseError:
                out["metadata_xml"] = xml_content[:3000]
        except Exception:
            pass
        return out

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
        cumulative_offset: int = 0,
        grand_total: int | None = None,
    ) -> None:
        """Insert features in multi-row batches for performance.

        ``cumulative_offset`` and ``grand_total`` let chunked callers
        report accurate progress across multiple invocations:
        ``progress = 5 + ((cumulative_offset + batch_end) / grand_total) * 90``.
        Default values preserve the single-call behaviour
        (``progress = 5 + (batch_end / len(gdf)) * 90``) so the snapshot
        endpoint at ``api/v1/datasets.py`` keeps working unchanged.
        """
        if not _validate_table_name(table_name):
            raise ValueError(f"Invalid table name: {table_name}")

        total = len(gdf)
        progress_total = grand_total if grand_total is not None else total
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
            if job_id is not None and progress_total > 0:
                done = cumulative_offset + batch_end
                progress = 5 + int((done / progress_total) * 90)
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
        *,
        layer_name: str | None = None,
    ) -> None:
        """Background vector processing with its own DB session.

        When ``layer_name`` is set, ``file_path`` points at a multi-layer
        container (a .gdb directory) and the named layer is read via the
        OpenFileGDB driver. Shapefile-ZIP validation is skipped in that case.
        """
        async with AsyncSessionLocal() as db:
            try:
                from app.crud import dataset as dataset_crud

                # Mark job as processing
                job = await dataset_crud.get_upload_job(db, job_id)
                if job:
                    await dataset_crud.update_upload_job(
                        db, job, status="processing", progress=5
                    )

                # Validate shapefile ZIP contents before reading (only for
                # the file-based path — .gdb layers don't need this check).
                if layer_name is None and str(file_path).lower().endswith(".zip"):
                    import zipfile

                    with zipfile.ZipFile(str(file_path), "r") as zf:
                        names_lower = [n.lower() for n in zf.namelist()]
                        has_shp = any(n.endswith(".shp") for n in names_lower)
                        if has_shp:
                            has_shx = any(n.endswith(".shx") for n in names_lower)
                            has_dbf = any(n.endswith(".dbf") for n in names_lower)
                            missing = []
                            if not has_shx:
                                missing.append(".shx")
                            if not has_dbf:
                                missing.append(".dbf")
                            if missing:
                                raise UploadError.invalid_shapefile_bundle(missing)

                # Probe the source for header info (feature count, CRS,
                # field schema). Cheap — does not read any feature rows.
                try:
                    info, chunks = await asyncio.to_thread(
                        _iter_vector_chunks,
                        file_path,
                        layer_name=layer_name,
                    )
                except Exception as e:
                    if layer_name is not None:
                        raise UploadError(
                            UploadErrorCode.GDB_LAYER_UNREADABLE,
                            f"Could not read GDB layer '{layer_name}': {e}",
                        ) from e
                    raise

                if info.feature_count <= 0:
                    raise UploadError.empty_file()
                if info.crs is None:
                    raise UploadError.missing_crs()

                table_name = f"vector_data_{str(dataset_id).replace('-', '_')}"
                await self._create_vector_table(db, table_name)

                # Streaming accumulators. Memory stays bounded to one
                # chunk at a time regardless of layer size.
                geom_types: set[str] = set()
                bounds: list[float] | None = None
                features_processed = 0
                source_crs_str: str | None = None
                source_crs_epsg: int | None = None
                fields: list[dict[str, str]] | None = None

                while True:
                    chunk = await asyncio.to_thread(next, chunks, None)
                    if chunk is None:
                        break

                    # Capture schema info from the first chunk only —
                    # all chunks share the same fields and source CRS.
                    if fields is None:
                        source_crs_str = str(chunk.crs) if chunk.crs else None
                        source_crs_epsg = (
                            chunk.crs.to_epsg() if chunk.crs is not None else None
                        )
                        fields = [
                            {"name": c, "dtype": str(chunk[c].dtype)}
                            for c in chunk.columns
                            if c != "geometry"
                        ]

                    # Reproject to WGS84 per chunk. (Z was already
                    # dropped at the read by force_2d=True in
                    # _iter_vector_chunks, so no Python-side strip
                    # step needed here.)
                    if chunk.crs is not None and chunk.crs.to_epsg() != 4326:
                        chunk = chunk.to_crs(epsg=4326)

                    geom_types.update(chunk.geometry.geom_type.unique().tolist())
                    bounds = _merge_bounds(bounds, chunk.total_bounds)

                    # Insert this chunk in 500-row sub-batches; pass the
                    # cumulative offset so progress reflects total work.
                    await self._insert_features_batched(
                        db,
                        table_name,
                        chunk,
                        job_id=job_id,
                        cumulative_offset=features_processed,
                        grand_total=info.feature_count,
                    )
                    features_processed += len(chunk)

                # Single-vs-mixed geometry type: use the unique value if
                # there's exactly one across all chunks, otherwise the
                # PostGIS-friendly placeholder "Geometry".
                geom_type = (
                    next(iter(geom_types)) if len(geom_types) == 1 else "Geometry"
                )
                bounds_list = bounds if bounds is not None else [0.0, 0.0, 0.0, 0.0]

                file_metadata: dict[str, Any] = {
                    "crs": source_crs_str,
                    "crs_epsg": source_crs_epsg,
                    "field_count": len(fields or []),
                    "fields": fields or [],
                    "total_features": features_processed,
                    "total_bounds": bounds_list,
                    "geometry_types": sorted(geom_types),
                }

                # GeoPackage embedded metadata + shapefile companion FGDC XML
                file_metadata.update(self._extract_gpkg_metadata(file_path))
                file_metadata.update(self._extract_fgdc_xml(file_path))

                # Update dataset with results
                dataset = await dataset_crud.get_dataset(db, dataset_id)
                if dataset:
                    dataset.geometry_type = geom_type
                    dataset.feature_count = features_processed
                    dataset.table_name = table_name
                    dataset.service_metadata = file_metadata
                    await db.commit()

                # Mark job completed
                job_kwargs: dict[str, Any] = {
                    "status": "completed",
                    "progress": 100,
                    "completed_at": datetime.now(timezone.utc),
                }
                job = await dataset_crud.get_upload_job(db, job_id)
                if job:
                    await dataset_crud.update_upload_job(db, job, **job_kwargs)

                logger.info(
                    "Background vector processing completed: dataset=%s features=%d",
                    dataset_id,
                    features_processed,
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
                                error_code=(
                                    e.code.value
                                    if isinstance(e, UploadError)
                                    else UploadErrorCode.PROCESSING_FAILED.value
                                ),
                            )

                        # Drop a partially-populated table if a chunk
                        # failed mid-stream. dataset.table_name is set
                        # only on full success, so we reconstruct the
                        # deterministic name from dataset_id (matches
                        # the formula used in the success path).
                        partial_table = (
                            f"vector_data_{str(dataset_id).replace('-', '_')}"
                        )
                        if _validate_table_name(partial_table):
                            try:
                                await err_db.execute(
                                    text(f'DROP TABLE IF EXISTS "{partial_table}"')
                                )
                                await err_db.commit()
                            except Exception:
                                logger.exception(
                                    "Failed to drop orphaned vector table %s",
                                    partial_table,
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
                    meta = result.get("metadata", {})
                    dataset.service_metadata = meta
                    # Store WGS84 bounds for map display
                    bounds = result.get("bounds_wgs84")
                    if bounds and len(bounds) == 4:
                        from geoalchemy2.shape import from_shape
                        from shapely.geometry import box

                        dataset.bounds = from_shape(
                            box(bounds[0], bounds[1], bounds[2], bounds[3]),
                            srid=4326,
                        )

                    # Auto-set default raster style_config
                    dataset.style_config = self._compute_default_raster_style(meta)

                    await db.commit()

                # Build job completion message
                job_kwargs: dict[str, Any] = {
                    "status": "completed",
                    "progress": 100,
                    "completed_at": datetime.now(timezone.utc),
                }
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
                                error_code=(
                                    e.code.value
                                    if isinstance(e, UploadError)
                                    else UploadErrorCode.PROCESSING_FAILED.value
                                ),
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

    @staticmethod
    def extract_members_to_dir(
        zip_path: Path,
        members: list[str],
        dest_dir: Path,
    ) -> Path:
        """Extract specific ZIP members into ``dest_dir`` as flat filenames.

        Returns the path to the first extracted member (the primary file).
        All members are extracted to the same directory, using only their
        basename, so shapefile sidecars land next to the .shp.
        """
        import zipfile

        dest_dir.mkdir(parents=True, exist_ok=True)
        primary_out: Path | None = None
        with zipfile.ZipFile(str(zip_path), "r") as zf:
            for member in members:
                source = zf.open(member)
                target = dest_dir / Path(member).name
                with open(target, "wb") as out:
                    shutil.copyfileobj(source, out)
                if primary_out is None:
                    primary_out = target
        if primary_out is None:
            raise ValueError("No members extracted from ZIP")
        return primary_out

    @staticmethod
    def extract_members_preserving_tree(
        zip_path: Path,
        members: list[str],
        dest_dir: Path,
    ) -> Path:
        """Extract members preserving their relative directory structure.

        Used for multi-layer containers (.gdb directories, .lpk files) where
        the directory layout is part of the data and must be kept intact for
        GDAL / OpenFileGDB to read the layer.
        """
        import zipfile

        dest_dir.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(str(zip_path), "r") as zf:
            for member in members:
                rel = member.replace("\\", "/")
                target = dest_dir / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(member) as src, open(target, "wb") as out:
                    shutil.copyfileobj(src, out)
        return dest_dir

    @staticmethod
    def _gdb_raster_to_geotiff(
        gdb_path: Path, raster_layer: str, out_path: Path
    ) -> None:
        """Materialize a single raster layer from a .gdb as a standalone GeoTIFF.

        OpenFileGDB exposes raster datasets as subdatasets. ``gdal.Translate``
        copies the named subdataset into a regular GeoTIFF that the existing
        rasterio-based COG pipeline can process.
        """
        from osgeo import gdal

        gdal.UseExceptions()
        # Subdataset URI format used by the OpenFileGDB driver.
        subdataset = f"OpenFileGDB:{gdb_path}:{raster_layer}"
        out_path.parent.mkdir(parents=True, exist_ok=True)
        ds = gdal.Translate(str(out_path), subdataset, format="GTiff")
        if ds is None:
            raise ValueError(
                f"Failed to extract raster layer '{raster_layer}' from "
                f"{gdb_path.name}"
            )
        ds = None  # close

    async def process_gdb_raster_layer_background(
        self,
        gdb_path: Path,
        layer_name: str,
        dataset_id: uuid.UUID,
        job_id: uuid.UUID,
    ) -> None:
        """Background processing for a single raster layer inside a .gdb.

        Materializes the raster as a temporary GeoTIFF, then hands it off to
        the existing raster pipeline (which performs CRS validation, COG
        conversion, and pyramid generation).
        """
        # Materialize the raster to a temp GeoTIFF in the same processing dir
        # so the standard cleanup (shutil.rmtree on file_path.parent) sweeps
        # both the .gdb extract and the temp .tif.
        work_dir = gdb_path.parent
        tif_path = work_dir / f"_gdb_raster_{layer_name}_{dataset_id.hex}.tif"
        await asyncio.to_thread(
            self._gdb_raster_to_geotiff, gdb_path, layer_name, tif_path
        )
        # process_raster_background owns its own try/except and job-state
        # updates; any failure inside it is recorded against the job.
        await self.process_raster_background(tif_path, dataset_id, job_id)

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

    @staticmethod
    def _compute_default_raster_style(metadata: dict) -> dict:
        """Compute sensible default style_config for a raster dataset."""
        band_count = metadata.get("band_count", 1)

        # Multi-band RGB: no colormap needed
        if band_count >= 3:
            return {}

        # Classified: use embedded colormap
        colormap = metadata.get("colormap")
        if colormap:
            value_map: dict[str, dict] = {}
            for val_str, rgba in colormap.items():
                value_map[val_str] = {
                    "color": list(rgba[:4]) if len(rgba) >= 4 else list(rgba) + [255],
                    "label": f"Class {val_str}",
                }
            return {
                "raster_mode": "classified",
                "band": 1,
                "value_map": value_map,
                "nodata_transparent": True,
            }

        # Classified: use RAT labels with auto-assigned colors
        rat = metadata.get("rat")
        if rat:
            from app.services.raster_colormap import get_category_color

            value_map = {}
            for i, (val_str, entry) in enumerate(rat.items()):
                color = get_category_color(i)
                value_map[val_str] = {
                    "color": list(color),
                    "label": entry.get("label", f"Class {val_str}"),
                }
            return {
                "raster_mode": "classified",
                "band": 1,
                "value_map": value_map,
                "nodata_transparent": True,
            }

        # Default: continuous viridis (min/max unset = auto-stretch per tile)
        return {
            "raster_mode": "continuous",
            "band": 1,
            "color_ramp": "viridis",
            "nodata_transparent": True,
        }

    @staticmethod
    def _extract_rat(raster_path: Path) -> dict | None:
        """Extract Raster Attribute Table from .vat.dbf sidecar or GDAL metadata."""
        # Source 1: sidecar .vat.dbf (Esri format)
        for pattern in [
            raster_path.with_suffix(".vat.dbf"),
            raster_path.parent / (raster_path.stem + ".vat.dbf"),
            raster_path.parent / (raster_path.name + ".vat.dbf"),
        ]:
            if pattern.exists():
                try:
                    from dbfread import DBF

                    table = DBF(str(pattern))
                    rat: dict[str, dict] = {}
                    for record in table:
                        val = str(record.get("Value", record.get("VALUE", "")))
                        if not val:
                            continue
                        # Look for label in common field names
                        label = None
                        for key in (
                            "Class_Name",
                            "CLASS_NAME",
                            "ClassName",
                            "Description",
                            "Label",
                            "LABEL",
                            "Name",
                            "NAME",
                        ):
                            if record.get(key):
                                label = str(record[key])
                                break
                        if not label:
                            label = f"Class {val}"
                        rat[val] = {
                            "label": label,
                            "fields": {
                                k: (str(v) if v is not None else None)
                                for k, v in record.items()
                            },
                        }
                    if rat:
                        return rat
                except Exception:
                    logger.debug(
                        "Failed to parse .vat.dbf for %s", raster_path, exc_info=True
                    )

        # Source 2: embedded RAT via GDAL
        try:
            from osgeo import gdal

            ds = gdal.Open(str(raster_path))
            if ds:
                band = ds.GetRasterBand(1)
                gdal_rat = band.GetDefaultRAT()
                if gdal_rat and gdal_rat.GetRowCount() > 0:
                    cols = {
                        gdal_rat.GetNameOfCol(i): i
                        for i in range(gdal_rat.GetColumnCount())
                    }
                    val_col = cols.get("Value", cols.get("VALUE", 0))
                    label_col = None
                    for name in ("Class_Name", "ClassName", "Label", "Description"):
                        if name in cols:
                            label_col = cols[name]
                            break
                    rat = {}
                    for row in range(gdal_rat.GetRowCount()):
                        val = str(gdal_rat.GetValueAsInt(row, val_col))
                        label = (
                            gdal_rat.GetValueAsString(row, label_col)
                            if label_col is not None
                            else f"Class {val}"
                        )
                        rat[val] = {"label": label}
                    ds = None
                    if rat:
                        return rat
                ds = None
        except Exception:
            pass  # GDAL not available or no RAT

        return None

    @staticmethod
    def _build_overviews(raster_path: Path) -> None:
        """Build pyramid overviews for efficient tile serving at low zoom levels."""
        try:
            with rasterio.open(str(raster_path), "r+") as dst:
                from rasterio.enums import Resampling as RasterResampling

                overview_levels = [2, 4, 8, 16, 32]
                dst.build_overviews(overview_levels, RasterResampling.nearest)
                dst.update_tags(ns="rio_overview", resampling="nearest")
                logger.info("Built overviews for %s", raster_path)
        except Exception:
            logger.warning(
                "Could not build overviews for %s — tile serving may use "
                "excessive memory for large rasters",
                raster_path,
                exc_info=True,
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

            # Extract Raster Attribute Table (RAT) from sidecar .vat.dbf or GDAL
            rat = self._extract_rat(file_path)
            if rat:
                metadata["rat"] = rat

            if original_crs is None:
                raise UploadError(
                    UploadErrorCode.MISSING_CRS,
                    "No coordinate reference system (CRS) found in the raster file. "
                    "The application requires a CRS to display data correctly. "
                    "Please define a CRS in the file metadata before uploading.",
                )
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
                self._build_overviews(output_path)

        return {
            "file_path": str(output_path),
            "bounds_wgs84": bounds_wgs84,
            "metadata": metadata,
        }


file_processor = FileProcessor()
