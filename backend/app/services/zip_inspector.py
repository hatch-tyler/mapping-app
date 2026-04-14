"""ZIP archive inspector for detecting multiple datasets within a single upload.

Detects shapefiles, GeoTIFFs, GeoPackages, GeoJSONs, and Esri grid formats.
Groups multi-file datasets (shapefiles, BIL/BIP/BSQ/FLT/ASC with sidecars) by basename.
"""

from __future__ import annotations

import logging
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
    format: str  # "shapefile", "geotiff", "geopackage", "geojson", "grid"
    primary_file: str  # path within the ZIP
    member_files: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


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


def inspect_zip(zip_path: Path) -> list[DetectedDataset]:
    """Inspect a ZIP archive and return a list of detected datasets.

    Each shapefile is grouped by basename (requires .shp + .shx + .dbf).
    Each raster (.tif/.jp2/.img) is one dataset with any matching sidecars.
    Esri grid formats (.bil/.bip/.bsq/.flt/.asc) group with .hdr / .prj sidecars.
    Each .gpkg and .geojson/.json is an independent dataset.
    """
    entries = _list_entries(zip_path)

    # Group files by (directory, stem)
    groups: dict[tuple[str, str], list[str]] = {}
    for entry in entries:
        groups.setdefault(_basename_key(entry), []).append(entry)

    detected: list[DetectedDataset] = []
    consumed: set[str] = set()

    # First pass: primary-file detection in priority order
    for entry in entries:
        if entry in consumed:
            continue
        ext = _ext(entry)
        key = _basename_key(entry)
        siblings = groups.get(key, [])
        sibling_exts = {_ext(s) for s in siblings}

        # Shapefile
        if ext == SHAPEFILE_EXT:
            members = [entry]
            warnings: list[str] = []
            # Required sidecars
            missing = []
            for req in SHAPEFILE_REQUIRED_SIDECARS:
                match = next(
                    (s for s in siblings if _ext(s) == req), None
                )
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
                match = next(
                    (s for s in siblings if _ext(s) == opt), None
                )
                if match:
                    members.append(match)
            if ".prj" not in sibling_exts:
                warnings.append(
                    "Missing .prj — projection will be assumed WGS84 (EPSG:4326)"
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
                    format="geotiff" if ext in {".tif", ".tiff", ".geotiff"}
                    else ext.lstrip("."),
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
                warnings.append(
                    f"{ext} requires a .hdr sidecar for spatial reference"
                )
            if not has_prj:
                warnings.append(
                    "Missing .prj — projection will be assumed WGS84 (EPSG:4326)"
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
