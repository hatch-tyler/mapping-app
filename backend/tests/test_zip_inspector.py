"""Tests for zip_inspector detection logic."""

from __future__ import annotations

import zipfile
from pathlib import Path

from app.services.zip_inspector import inspect_zip


def _make_zip(tmp_path: Path, entries: dict[str, bytes]) -> Path:
    """Build a ZIP file at tmp_path/test.zip with the given entries."""
    zip_path = tmp_path / "test.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        for name, data in entries.items():
            zf.writestr(name, data)
    return zip_path


class TestShapefileDetection:
    def test_complete_shapefile(self, tmp_path: Path):
        zip_path = _make_zip(
            tmp_path,
            {
                "counties.shp": b"shp",
                "counties.shx": b"shx",
                "counties.dbf": b"dbf",
                "counties.prj": b"prj",
            },
        )
        datasets = inspect_zip(zip_path)
        assert len(datasets) == 1
        d = datasets[0]
        assert d.data_type == "vector"
        assert d.format == "shapefile"
        assert d.suggested_name == "counties"
        assert d.primary_file == "counties.shp"
        assert set(d.member_files) == {
            "counties.shp",
            "counties.shx",
            "counties.dbf",
            "counties.prj",
        }
        assert d.warnings == []

    def test_shapefile_missing_prj(self, tmp_path: Path):
        zip_path = _make_zip(
            tmp_path,
            {
                "a.shp": b"s",
                "a.shx": b"s",
                "a.dbf": b"s",
            },
        )
        datasets = inspect_zip(zip_path)
        assert len(datasets) == 1
        assert any("prj" in w.lower() for w in datasets[0].warnings)

    def test_shapefile_missing_shx(self, tmp_path: Path):
        zip_path = _make_zip(
            tmp_path,
            {
                "a.shp": b"s",
                "a.dbf": b"s",
            },
        )
        datasets = inspect_zip(zip_path)
        assert len(datasets) == 1
        assert any(".shx" in w for w in datasets[0].warnings)

    def test_multiple_shapefiles(self, tmp_path: Path):
        zip_path = _make_zip(
            tmp_path,
            {
                "a.shp": b"s",
                "a.shx": b"s",
                "a.dbf": b"s",
                "a.prj": b"p",
                "b.shp": b"s",
                "b.shx": b"s",
                "b.dbf": b"s",
                "b.prj": b"p",
            },
        )
        datasets = inspect_zip(zip_path)
        assert len(datasets) == 2
        primary_files = {d.primary_file for d in datasets}
        assert primary_files == {"a.shp", "b.shp"}

    def test_shapefile_in_subdirectory(self, tmp_path: Path):
        zip_path = _make_zip(
            tmp_path,
            {
                "nested/dir/a.shp": b"s",
                "nested/dir/a.shx": b"s",
                "nested/dir/a.dbf": b"s",
                "nested/dir/a.prj": b"p",
            },
        )
        datasets = inspect_zip(zip_path)
        assert len(datasets) == 1
        assert datasets[0].primary_file == "nested/dir/a.shp"
        assert datasets[0].suggested_name == "a"


class TestRasterDetection:
    def test_geotiff(self, tmp_path: Path):
        zip_path = _make_zip(
            tmp_path,
            {
                "elevation.tif": b"tif",
                "elevation.tfw": b"world",
                "elevation.aux.xml": b"aux",
            },
        )
        datasets = inspect_zip(zip_path)
        assert len(datasets) == 1
        d = datasets[0]
        assert d.data_type == "raster"
        assert d.format == "geotiff"
        assert set(d.member_files) == {
            "elevation.tif",
            "elevation.tfw",
            "elevation.aux.xml",
        }

    def test_multiple_geotiffs(self, tmp_path: Path):
        zip_path = _make_zip(
            tmp_path,
            {"a.tif": b"a", "b.tif": b"b"},
        )
        datasets = inspect_zip(zip_path)
        assert len(datasets) == 2

    def test_bil_with_hdr_and_prj(self, tmp_path: Path):
        zip_path = _make_zip(
            tmp_path,
            {
                "dem.bil": b"bil",
                "dem.hdr": b"hdr",
                "dem.prj": b"prj",
            },
        )
        datasets = inspect_zip(zip_path)
        assert len(datasets) == 1
        d = datasets[0]
        assert d.data_type == "raster"
        assert d.format == "grid"
        assert d.warnings == []

    def test_bil_missing_hdr_warns(self, tmp_path: Path):
        zip_path = _make_zip(tmp_path, {"dem.bil": b"bil", "dem.prj": b"p"})
        datasets = inspect_zip(zip_path)
        assert any(".hdr" in w for w in datasets[0].warnings)


class TestGeopackageAndGeojson:
    def test_geopackage(self, tmp_path: Path):
        zip_path = _make_zip(tmp_path, {"parcels.gpkg": b"sqlite-magic"})
        datasets = inspect_zip(zip_path)
        assert len(datasets) == 1
        assert datasets[0].format == "geopackage"
        assert any("multi-layer" in w.lower() for w in datasets[0].warnings)

    def test_geojson(self, tmp_path: Path):
        zip_path = _make_zip(
            tmp_path, {"cities.geojson": b'{"type":"FeatureCollection"}'}
        )
        datasets = inspect_zip(zip_path)
        assert len(datasets) == 1
        assert datasets[0].format == "geojson"

    def test_plain_json(self, tmp_path: Path):
        zip_path = _make_zip(tmp_path, {"data.json": b'{"type":"FeatureCollection"}'})
        datasets = inspect_zip(zip_path)
        assert len(datasets) == 1
        assert datasets[0].format == "geojson"


class TestMixedAndEdgeCases:
    def test_mix_shapefile_and_geotiff(self, tmp_path: Path):
        zip_path = _make_zip(
            tmp_path,
            {
                "a.shp": b"s",
                "a.shx": b"s",
                "a.dbf": b"s",
                "a.prj": b"p",
                "b.tif": b"t",
            },
        )
        datasets = inspect_zip(zip_path)
        assert len(datasets) == 2
        types = sorted(d.data_type for d in datasets)
        assert types == ["raster", "vector"]

    def test_empty_zip(self, tmp_path: Path):
        zip_path = _make_zip(tmp_path, {})
        datasets = inspect_zip(zip_path)
        assert datasets == []

    def test_ignore_macosx_metadata(self, tmp_path: Path):
        zip_path = _make_zip(
            tmp_path,
            {
                "a.shp": b"s",
                "a.shx": b"s",
                "a.dbf": b"s",
                "__MACOSX/a.shp": b"junk",
                "._a.shp": b"junk",
            },
        )
        datasets = inspect_zip(zip_path)
        assert len(datasets) == 1
        assert "__MACOSX/a.shp" not in datasets[0].member_files
        assert "._a.shp" not in datasets[0].member_files

    def test_non_geo_files_ignored(self, tmp_path: Path):
        zip_path = _make_zip(
            tmp_path,
            {
                "readme.txt": b"hi",
                "docs.pdf": b"pdf",
            },
        )
        datasets = inspect_zip(zip_path)
        assert datasets == []


class TestDetectedDatasetOrdering:
    def test_stable_sort_by_primary_file(self, tmp_path: Path):
        zip_path = _make_zip(
            tmp_path,
            {
                "z.tif": b"z",
                "a.tif": b"a",
                "m.tif": b"m",
            },
        )
        datasets = inspect_zip(zip_path)
        assert [d.primary_file for d in datasets] == ["a.tif", "m.tif", "z.tif"]
