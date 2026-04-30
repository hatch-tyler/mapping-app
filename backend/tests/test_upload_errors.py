"""Tests for the typed upload error codes and warnings."""

from __future__ import annotations

from app.services.upload_errors import (
    BLOCKING_WARNING_CODES,
    DetectedWarning,
    UploadError,
    UploadErrorCode,
    WarningCode,
)


class TestUploadErrorFactories:
    def test_missing_crs_carries_code(self):
        err = UploadError.missing_crs()
        assert err.code is UploadErrorCode.MISSING_CRS
        assert "CRS" in err.message

    def test_empty_file_carries_code(self):
        err = UploadError.empty_file()
        assert err.code is UploadErrorCode.EMPTY_FILE

    def test_invalid_shapefile_bundle_lists_missing(self):
        err = UploadError.invalid_shapefile_bundle([".shx", ".dbf"])
        assert err.code is UploadErrorCode.INVALID_SHAPEFILE_BUNDLE
        assert ".shx" in err.message
        assert ".dbf" in err.message

    def test_codes_are_stable_strings(self):
        # The frontend matches on the .value (str). Locking these in so a
        # rename on the backend would break a test, prompting a frontend
        # update.
        assert UploadErrorCode.MISSING_CRS.value == "missing_crs"
        assert UploadErrorCode.EMPTY_FILE.value == "empty_file"
        assert UploadErrorCode.PROCESSING_FAILED.value == "processing_failed"
        assert UploadErrorCode.GDB_LAYER_UNREADABLE.value == "gdb_layer_unreadable"
        assert UploadErrorCode.SERVER_RESTART.value == "server_restart"


class TestWarningCodes:
    def test_blocking_set_includes_shapefile_missing_required(self):
        assert WarningCode.SHAPEFILE_MISSING_REQUIRED in BLOCKING_WARNING_CODES

    def test_blocking_set_excludes_advisory_codes(self):
        # MISSING_PRJ is informational — uploads will fail at processing time,
        # but selecting the dataset isn't *blocked* in the UI.
        assert WarningCode.MISSING_PRJ not in BLOCKING_WARNING_CODES
        assert WarningCode.GPKG_FIRST_LAYER_ONLY not in BLOCKING_WARNING_CODES

    def test_detected_warning_round_trips(self):
        w = DetectedWarning(code=WarningCode.MISSING_PRJ, message="missing")
        assert w.code is WarningCode.MISSING_PRJ
        assert w.message == "missing"
