"""Typed error codes for the upload pipeline.

Existed as ad-hoc string messages; consumers (frontend, tests) had to match
on substrings to react to specific failures. The codes here let the frontend
switch on a stable identifier and ignore the exact wording.

Two concepts:

* :class:`UploadErrorCode` — a hard failure attached to an ``UploadJob``
  (the job's ``error_code`` field). Surfaced via ``UploadJobResponse``.
* :class:`WarningCode` — a non-fatal observation about a detected dataset
  in the inspect-bundle UI. Surfaced via ``DetectedDataset.warnings`` as
  ``DetectedWarning(code, message)`` records.

Codes are stable strings (not opaque integers) so log lines and debugging
remain readable.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class UploadErrorCode(str, Enum):
    """Stable identifiers for upload-job failure modes."""

    # Vector / raster preconditions
    MISSING_CRS = "missing_crs"
    EMPTY_FILE = "empty_file"

    # Shapefile bundle structure
    INVALID_SHAPEFILE_BUNDLE = "invalid_shapefile_bundle"

    # Multi-layer container failures
    GDB_LAYER_UNREADABLE = "gdb_layer_unreadable"
    GDB_RASTER_TRANSLATE_FAILED = "gdb_raster_translate_failed"
    BUNDLE_INNER_NOT_FOUND = "bundle_inner_not_found"

    # Operational failure: the worker died or was restarted while the job
    # was in flight. Distinct from data-quality failures so the UI can
    # suggest a simple retry rather than asking the user to fix their data.
    SERVER_RESTART = "server_restart"

    # Catch-all for anything else; pair with a descriptive ``error_message``.
    PROCESSING_FAILED = "processing_failed"


class WarningCode(str, Enum):
    """Stable identifiers for non-fatal observations on a detected dataset."""

    SHAPEFILE_MISSING_REQUIRED = "shapefile_missing_required"
    MISSING_PRJ = "missing_prj"
    GRID_MISSING_HDR = "grid_missing_hdr"
    GPKG_FIRST_LAYER_ONLY = "gpkg_first_layer_only"
    GDB_UNREADABLE = "gdb_unreadable"
    LPK_NO_DATA_SOURCES = "lpk_no_data_sources"


@dataclass
class DetectedWarning:
    """A code+message pair attached to a ``DetectedDataset``.

    The ``code`` is stable and machine-readable; ``message`` is a
    human-readable description that callers may surface verbatim in the UI.
    """

    code: WarningCode
    message: str


# Warning predicates used to decide UI affordances. Centralized here so the
# backend and frontend agree (the frontend mirrors via the ``code`` value).

BLOCKING_WARNING_CODES: frozenset[WarningCode] = frozenset(
    {
        WarningCode.SHAPEFILE_MISSING_REQUIRED,
    }
)
"""Warning codes that should disable selection of the affected dataset.

The dataset *cannot* be processed at all if any of these are present
(e.g. a shapefile missing its .shx/.dbf companions).
"""


class UploadError(Exception):
    """A typed error thrown by the file processor.

    The bundle / single-file background processor catches these and records
    ``code`` on the UploadJob. Callers may construct one directly or pick a
    factory (e.g. ``UploadError.missing_crs()``) for the common cases.
    """

    def __init__(self, code: UploadErrorCode, message: str):
        super().__init__(message)
        self.code = code
        self.message = message

    @classmethod
    def missing_crs(cls) -> "UploadError":
        return cls(
            UploadErrorCode.MISSING_CRS,
            "No coordinate reference system (CRS) found. "
            "The application requires a CRS to display data correctly. "
            "Please add a .prj file (shapefiles) or define a CRS before uploading.",
        )

    @classmethod
    def empty_file(cls) -> "UploadError":
        return cls(UploadErrorCode.EMPTY_FILE, "File contains no features")

    @classmethod
    def invalid_shapefile_bundle(cls, missing: list[str]) -> "UploadError":
        return cls(
            UploadErrorCode.INVALID_SHAPEFILE_BUNDLE,
            f"Shapefile ZIP is missing required files: {', '.join(missing)}. "
            "A valid shapefile requires .shp, .shx, and .dbf files.",
        )
