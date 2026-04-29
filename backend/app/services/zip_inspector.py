"""ZIP archive inspector for detecting multiple datasets within a single upload.

Detects shapefiles, GeoTIFFs, GeoPackages, GeoJSONs, Esri grid formats,
File Geodatabases (.gdb directories), and Layer Packages (.lpk/.lpkx).
Groups multi-file datasets (shapefiles, BIL/BIP/BSQ/FLT/ASC with sidecars) by basename.
"""

from __future__ import annotations

import logging
import shutil
import tempfile
import zipfile
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Literal

logger = logging.getLogger(__name__)

# Primary file extensions that identify a dataset
SHAPEFILE_EXT = ".shp"
GEOPACKAGE_EXT = ".gpkg"
GEOJSON_EXTS = {".geojson", ".json"}
RASTER_PRIMARY_EXTS = {".tif", ".tiff", ".geotiff", ".jp2", ".img"}
GRID_PRIMARY_EXTS = {".bil", ".bip", ".bsq", ".flt", ".asc"}
LAYER_PACKAGE_EXTS = {".lpk", ".lpkx"}
GDB_DIR_SUFFIX = ".gdb"

# Sidecars that group with a primary file (by basename)
SHAPEFILE_REQUIRED_SIDECARS = {".shx", ".dbf"}
SHAPEFILE_OPTIONAL_SIDECARS = {".prj", ".cpg", ".sbn", ".sbx", ".qpj", ".shp.xml"}
RASTER_SIDECARS = {".tfw", ".jgw", ".wld", ".aux.xml", ".ovr", ".vat.dbf", ".prj"}
GRID_SIDECARS = {".hdr", ".prj", ".blw", ".flw", ".stx", ".aux.xml"}


DataType = Literal["vector", "raster"]


@dataclass
class DetectedDataset:
    """One dataset detected within an uploaded ZIP archive."""

    suggested_name: str
    data_type: DataType
    format: str  # shapefile, geotiff, geopackage, geojson, grid, gdb-vector, gdb-raster
    primary_file: str  # path within the ZIP
    member_files: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    # Set for multi-layer container formats (.gdb / .lpk / .lpkx). The bundle
    # processor uses these to find and read the right layer at process time.
    # ``container_path`` is the path within the uploaded ZIP to the .gdb
    # directory (no trailing slash) or to the .lpk/.lpkx file. ``layer_name``
    # is the layer/feature-class/raster name inside the container.
    container_path: str | None = None
    layer_name: str | None = None


def _posix(path: str) -> str:
    """Normalize ZIP entry to posix style (ZIP spec uses forward slashes)."""
    return path.replace("\\", "/")


def _ext(entry: str) -> str:
    """Return lowercase extension including leading dot (handles .shp.xml)."""
    name = _posix(entry).lower().rsplit("/", 1)[-1]
    if name.endswith(".shp.xml"):
        return ".shp.xml"
    if name.endswith(".aux.xml"):
        return ".aux.xml"
    if name.endswith(".vat.dbf"):
        return ".vat.dbf"
    i = name.rfind(".")
    return name[i:] if i >= 0 else ""


def _basename_key(entry: str) -> tuple[str, str]:
    """Return (directory, stem) used as a grouping key for related files.

    Strips compound extensions (.aux.xml, .shp.xml, .vat.dbf) so e.g.
    ``elevation.tif`` and ``elevation.aux.xml`` share the same key.
    """
    posix_entry = _posix(entry)
    p = PurePosixPath(posix_entry)
    ext = _ext(entry)
    name = p.name
    if ext and name.lower().endswith(ext):
        stem = name[: -len(ext)]
    else:
        stem = p.stem
    return (str(p.parent), stem)


def _list_entries(zip_path: Path) -> list[str]:
    """List non-directory entries in the ZIP, ignoring MACOSX metadata."""
    entries: list[str] = []
    with zipfile.ZipFile(str(zip_path), "r") as zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            name = _posix(info.filename)
            # Skip macOS resource forks and hidden files
            if "__MACOSX" in name or name.rsplit("/", 1)[-1].startswith("._"):
                continue
            entries.append(name)
    return entries


def _find_gdb_dirs(entries: list[str]) -> dict[str, list[str]]:
    """Group ZIP entries by their containing ``.gdb`` directory, if any.

    Returns a mapping of ``<dir>/<name>.gdb`` (no trailing slash, posix-style)
    to the list of entries that fall under that directory. Top-level .gdb
    directories use the bare ``<name>.gdb`` key.
    """
    gdbs: dict[str, list[str]] = {}
    for entry in entries:
        parts = entry.split("/")
        for i, part in enumerate(parts[:-1]):  # exclude the file itself
            if part.lower().endswith(GDB_DIR_SUFFIX):
                gdb_path = "/".join(parts[: i + 1])
                gdbs.setdefault(gdb_path, []).append(entry)
                break  # nested .gdbs are unusual; first match wins
    return gdbs


def _enumerate_gdb_layers(
    zip_path: Path, gdb_path_in_zip: str, members: list[str]
) -> list[DetectedDataset]:
    """Extract a .gdb subtree to a temp dir and enumerate its layers.

    Returns one ``DetectedDataset`` per vector feature class or raster dataset
    found, with ``container_path`` and ``layer_name`` populated so the bundle
    processor can later read the layer directly from the extracted container.
    Logs and returns an empty list on any failure (the inspector should never
    hard-fail an upload preview).
    """
    tmp_root = Path(tempfile.mkdtemp(prefix="gdb_inspect_"))
    try:
        # Extract just this .gdb's members, preserving relative directory tree
        # so the .gdb folder structure remains intact for GDAL.
        with zipfile.ZipFile(str(zip_path), "r") as zf:
            for member in members:
                rel = _posix(member)
                # Re-base each member under the parent of the .gdb directory so
                # the extracted layout mirrors what's in the ZIP.
                target = tmp_root / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(member) as src, open(target, "wb") as dst:
                    shutil.copyfileobj(src, dst)

        extracted_gdb = tmp_root / gdb_path_in_zip
        if not extracted_gdb.exists():
            logger.warning(
                "Extracted .gdb path %s not found after extraction", extracted_gdb
            )
            return []

        gdb_stem = PurePosixPath(gdb_path_in_zip).stem  # "foo.gdb" -> "foo"
        detected: list[DetectedDataset] = []

        # Vector feature classes via fiona (read-only enumeration)
        try:
            import fiona

            vector_layers = list(fiona.listlayers(str(extracted_gdb)))
        except Exception as e:
            logger.warning("Failed to list vector layers in %s: %s", gdb_path_in_zip, e)
            vector_layers = []

        for layer_name in vector_layers:
            detected.append(
                DetectedDataset(
                    suggested_name=f"{gdb_stem}__{layer_name}",
                    data_type="vector",
                    format="gdb-vector",
                    primary_file=f"{gdb_path_in_zip}::{layer_name}",
                    member_files=members,
                    container_path=gdb_path_in_zip,
                    layer_name=layer_name,
                )
            )

        # Raster datasets via GDAL OpenFileGDB subdataset listing.
        # Older GDAL builds may not expose rasters at all — wrap in try/except.
        try:
            from osgeo import gdal

            gdal.UseExceptions()
            ds = gdal.OpenEx(str(extracted_gdb), gdal.OF_RASTER)
            if ds is not None:
                subdatasets = ds.GetSubDatasets()
                ds = None
                for sub_name, _description in subdatasets:
                    # OpenFileGDB subdataset names look like
                    # "OpenFileGDB:/path/to/foo.gdb:layer_name"
                    raster_layer = sub_name.rsplit(":", 1)[-1]
                    detected.append(
                        DetectedDataset(
                            suggested_name=f"{gdb_stem}__{raster_layer}",
                            data_type="raster",
                            format="gdb-raster",
                            primary_file=f"{gdb_path_in_zip}::{raster_layer}",
                            member_files=members,
                            container_path=gdb_path_in_zip,
                            layer_name=raster_layer,
                        )
                    )
        except Exception as e:
            logger.debug(
                "GDAL raster enumeration unavailable for %s: %s", gdb_path_in_zip, e
            )

        return detected
    finally:
        try:
            shutil.rmtree(tmp_root, ignore_errors=True)
        except Exception:
            logger.debug("Failed to clean up temp dir %s", tmp_root, exc_info=True)


def _enumerate_layer_package(zip_path: Path, lpk_entry: str) -> list[DetectedDataset]:
    """Recursively detect data sources inside a .lpk / .lpkx file.

    Layer Packages are ZIPs that wrap a .gdb directory, shapefiles, or rasters
    plus a .lyr style definition. We ignore the .lyr (no reliable parser) and
    return one ``DetectedDataset`` per data source found inside.
    """
    tmp_root = Path(tempfile.mkdtemp(prefix="lpk_inspect_"))
    inner_zip_path = tmp_root / PurePosixPath(lpk_entry).name
    try:
        with zipfile.ZipFile(str(zip_path), "r") as zf:
            with zf.open(lpk_entry) as src, open(inner_zip_path, "wb") as dst:
                shutil.copyfileobj(src, dst)

        try:
            inner_detected = inspect_zip(inner_zip_path)
        except zipfile.BadZipFile:
            logger.warning("Layer package %s is not a valid ZIP", lpk_entry)
            return []

        # Tag every inner detection with the outer .lpk path so the bundle
        # processor can re-extract the inner ZIP at process time. layer_name
        # encodes "<inner_path>" for leaf datasets (shapefile/raster/gpkg) or
        # "<inner_gdb_path>::<feature_class>" for .gdb-wrapped layers — the
        # processor splits on '::' to disambiguate.
        retagged: list[DetectedDataset] = []
        lpk_stem = PurePosixPath(lpk_entry).stem
        for d in inner_detected:
            if d.container_path:
                # Nested container (e.g. .gdb inside .lpk) — preserve the path.
                inner_layer = d.layer_name or ""
                d.layer_name = f"{d.container_path}::{inner_layer}"
            else:
                # Leaf data source — its primary_file *is* the inner path.
                d.layer_name = d.primary_file
            d.container_path = lpk_entry
            d.member_files = [lpk_entry]  # only the outer .lpk needs extracting
            d.suggested_name = f"{lpk_stem}__{d.suggested_name}"
            d.primary_file = f"{lpk_entry}::{d.layer_name}"
            retagged.append(d)
        return retagged
    finally:
        try:
            shutil.rmtree(tmp_root, ignore_errors=True)
        except Exception:
            logger.debug("Failed to clean up temp dir %s", tmp_root, exc_info=True)


def inspect_zip(zip_path: Path) -> list[DetectedDataset]:
    """Inspect a ZIP archive and return a list of detected datasets.

    Each shapefile is grouped by basename (requires .shp + .shx + .dbf).
    Each raster (.tif/.jp2/.img) is one dataset with any matching sidecars.
    Esri grid formats (.bil/.bip/.bsq/.flt/.asc) group with .hdr / .prj sidecars.
    Each .gpkg and .geojson/.json is an independent dataset.
    File Geodatabases (.gdb directories) emit one detected dataset per layer.
    Layer Packages (.lpk/.lpkx) recurse into their wrapped data sources.
    """
    entries = _list_entries(zip_path)

    # Group files by (directory, stem)
    groups: dict[tuple[str, str], list[str]] = {}
    for entry in entries:
        groups.setdefault(_basename_key(entry), []).append(entry)

    detected: list[DetectedDataset] = []
    consumed: set[str] = set()

    # Pre-pass: detect .gdb directories (their members must be consumed before
    # the per-entry primary detection runs, otherwise we'd treat .gdbtable
    # files etc. as rasters or unknowns).
    gdb_dirs = _find_gdb_dirs(entries)
    for gdb_path_in_zip, gdb_members in gdb_dirs.items():
        gdb_layers = _enumerate_gdb_layers(zip_path, gdb_path_in_zip, gdb_members)
        if gdb_layers:
            detected.extend(gdb_layers)
        else:
            # .gdb was present but unreadable (corrupt or older v9 format).
            # Surface a single placeholder warning so the user understands.
            stem = PurePosixPath(gdb_path_in_zip).stem
            detected.append(
                DetectedDataset(
                    suggested_name=stem,
                    data_type="vector",
                    format="gdb-vector",
                    primary_file=gdb_path_in_zip,
                    member_files=gdb_members,
                    warnings=[
                        "Could not read this File Geodatabase. It may be corrupt "
                        "or in an unsupported format (v9 or older)."
                    ],
                    container_path=gdb_path_in_zip,
                )
            )
        consumed.update(gdb_members)

    # First pass: primary-file detection in priority order
    for entry in entries:
        if entry in consumed:
            continue
        ext = _ext(entry)
        key = _basename_key(entry)
        siblings = groups.get(key, [])
        sibling_exts = {_ext(s) for s in siblings}

        # Layer package (.lpk / .lpkx)
        if ext in LAYER_PACKAGE_EXTS:
            consumed.add(entry)
            inner = _enumerate_layer_package(zip_path, entry)
            if inner:
                detected.extend(inner)
            else:
                detected.append(
                    DetectedDataset(
                        suggested_name=PurePosixPath(entry).stem,
                        data_type="vector",
                        format="layer-package",
                        primary_file=entry,
                        member_files=[entry],
                        warnings=[
                            "Layer package contains no recognized data sources "
                            "(expected .gdb, shapefile, or raster inside)."
                        ],
                        container_path=entry,
                    )
                )
            continue

        # Shapefile
        if ext == SHAPEFILE_EXT:
            members = [entry]
            warnings: list[str] = []
            # Required sidecars
            missing = []
            for req in SHAPEFILE_REQUIRED_SIDECARS:
                match = next((s for s in siblings if _ext(s) == req), None)
                if match:
                    members.append(match)
                else:
                    missing.append(req)
            if missing:
                warnings.append(
                    f"Shapefile is missing required files: {', '.join(missing)}"
                )
            # Optional sidecars
            for opt in SHAPEFILE_OPTIONAL_SIDECARS:
                match = next((s for s in siblings if _ext(s) == opt), None)
                if match:
                    members.append(match)
            if ".prj" not in sibling_exts:
                warnings.append(
                    "Missing .prj — upload will fail without a coordinate reference system"
                )
            consumed.update(members)
            detected.append(
                DetectedDataset(
                    suggested_name=PurePosixPath(entry).stem,
                    data_type="vector",
                    format="shapefile",
                    primary_file=entry,
                    member_files=members,
                    warnings=warnings,
                )
            )
            continue

        # GeoPackage
        if ext == GEOPACKAGE_EXT:
            consumed.add(entry)
            detected.append(
                DetectedDataset(
                    suggested_name=PurePosixPath(entry).stem,
                    data_type="vector",
                    format="geopackage",
                    primary_file=entry,
                    member_files=[entry],
                    warnings=[
                        "Multi-layer GeoPackages will be imported as the first layer only",
                    ],
                )
            )
            continue

        # GeoJSON
        if ext in GEOJSON_EXTS:
            consumed.add(entry)
            detected.append(
                DetectedDataset(
                    suggested_name=PurePosixPath(entry).stem,
                    data_type="vector",
                    format="geojson",
                    primary_file=entry,
                    member_files=[entry],
                )
            )
            continue

        # Raster primary (tif/tiff/jp2/img)
        if ext in RASTER_PRIMARY_EXTS:
            members = [entry]
            # Sidecars share the basename
            for sib in siblings:
                if sib == entry:
                    continue
                if _ext(sib) in RASTER_SIDECARS:
                    members.append(sib)
            consumed.update(members)
            detected.append(
                DetectedDataset(
                    suggested_name=PurePosixPath(entry).stem,
                    data_type="raster",
                    format=(
                        "geotiff"
                        if ext in {".tif", ".tiff", ".geotiff"}
                        else ext.lstrip(".")
                    ),
                    primary_file=entry,
                    member_files=members,
                )
            )
            continue

        # Esri grid primary
        if ext in GRID_PRIMARY_EXTS:
            members = [entry]
            warnings = []
            has_hdr = False
            has_prj = False
            for sib in siblings:
                if sib == entry:
                    continue
                sib_ext = _ext(sib)
                if sib_ext in GRID_SIDECARS:
                    members.append(sib)
                    if sib_ext == ".hdr":
                        has_hdr = True
                    if sib_ext == ".prj":
                        has_prj = True
            if ext != ".asc" and not has_hdr:
                warnings.append(f"{ext} requires a .hdr sidecar for spatial reference")
            if not has_prj:
                warnings.append(
                    "Missing .prj — upload will fail without a coordinate reference system"
                )
            consumed.update(members)
            detected.append(
                DetectedDataset(
                    suggested_name=PurePosixPath(entry).stem,
                    data_type="raster",
                    format="grid",
                    primary_file=entry,
                    member_files=members,
                    warnings=warnings,
                )
            )

    # Sort alphabetically by primary_file for stable UI ordering
    detected.sort(key=lambda d: d.primary_file.lower())
    return detected
