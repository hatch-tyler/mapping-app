"""Tests for zip_inspector detection logic."""

from __future__ import annotations

import zipfile
from pathlib import Path

import pytest

from app.services.zip_inspector import inspect_zip


def _make_zip(tmp_path: Path, entries: dict[str, bytes]) -> Path:
    """Build a ZIP file at tmp_path/test.zip with the given entries."""
    zip_path = tmp_path / "test.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        for name, data in entries.items():
            zf.writestr(name, data)
    return zip_path


def _make_sample_gdb(tmp_path: Path, layers: dict[str, str] | None = None) -> Path:
    """Create a small File Geodatabase via geopandas + OpenFileGDB.

    Each entry in ``layers`` maps a feature class name to a WKT geometry
    representative ('Point', 'LineString', 'Polygon'). Skips the test if
    the runtime can't write GDBs (no GDAL / OpenFileGDB).
    """
    pytest.importorskip("fiona")
    pytest.importorskip("geopandas")
    import fiona
    import geopandas as gpd
    from shapely.geometry import Point, LineString, Polygon

    if "OpenFileGDB" not in fiona.supported_drivers:
        pytest.skip("OpenFileGDB driver not available in this GDAL build")
    # Read+write capability is required.
    if "w" not in fiona.supported_drivers["OpenFileGDB"]:
        pytest.skip("OpenFileGDB driver is read-only on this GDAL build")

    layers = layers or {"points": "Point", "lines": "LineString"}
    gdb_path = tmp_path / "sample.gdb"

    geometry_makers = {
        "Point": lambda: Point(-122.4, 37.8),
        "LineString": lambda: LineString([(0, 0), (1, 1)]),
        "Polygon": lambda: Polygon([(0, 0), (1, 0), (1, 1), (0, 1)]),
    }

    for layer_name, geom_kind in layers.items():
        gdf = gpd.GeoDataFrame(
            {"id": [1, 2], "name": ["a", "b"]},
            geometry=[geometry_makers[geom_kind](), geometry_makers[geom_kind]()],
            crs="EPSG:4326",
        )
        gdf.to_file(str(gdb_path), driver="OpenFileGDB", layer=layer_name)

    return gdb_path


def _zip_directory(src_dir: Path, zip_path: Path, prefix: str = "") -> Path:
    """ZIP the contents of src_dir, optionally under a prefix path."""
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_STORED) as zf:
        for path in src_dir.rglob("*"):
            if path.is_file():
                rel = path.relative_to(src_dir.parent).as_posix()
                if prefix:
                    rel = f"{prefix.rstrip('/')}/{rel}"
                zf.write(path, arcname=rel)
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


class TestEntryPathField:
    """The ``entry_path`` field disambiguates plain files from container layers."""

    def test_plain_files_have_entry_path(self, tmp_path: Path):
        zip_path = _make_zip(
            tmp_path,
            {
                "a.shp": b"s",
                "a.shx": b"s",
                "a.dbf": b"s",
                "a.prj": b"p",
                "b.tif": b"t",
                "c.geojson": b'{"type":"FeatureCollection","features":[]}',
                "d.gpkg": b"sqlite",
            },
        )
        datasets = inspect_zip(zip_path)
        for d in datasets:
            assert d.entry_path == d.primary_file, d
            assert d.container_path is None, d

    def test_gdb_layers_have_no_entry_path(self, tmp_path: Path):
        gdb_path = _make_sample_gdb(tmp_path, {"points": "Point"})
        zip_path = _zip_directory(gdb_path, tmp_path / "sample.gdb.zip")
        datasets = inspect_zip(zip_path)
        gdb_layers = [d for d in datasets if d.format == "gdb-vector"]
        assert gdb_layers
        for d in gdb_layers:
            assert d.entry_path is None
            assert d.container_path is not None


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


class TestFileGeodatabaseDetection:
    def test_gdb_zip_emits_one_dataset_per_feature_class(self, tmp_path: Path):
        gdb_path = _make_sample_gdb(
            tmp_path, {"points": "Point", "lines": "LineString"}
        )
        zip_path = _zip_directory(gdb_path, tmp_path / "sample.gdb.zip")

        datasets = inspect_zip(zip_path)
        assert len(datasets) >= 2, datasets
        formats = {d.format for d in datasets}
        assert "gdb-vector" in formats
        layer_names = {d.layer_name for d in datasets if d.format == "gdb-vector"}
        assert {"points", "lines"} <= layer_names
        for d in datasets:
            if d.format == "gdb-vector":
                assert d.container_path is not None
                assert d.container_path.endswith(".gdb")
                assert d.data_type == "vector"

    def test_gdb_inside_subdirectory(self, tmp_path: Path):
        gdb_path = _make_sample_gdb(tmp_path, {"points": "Point"})
        zip_path = _zip_directory(gdb_path, tmp_path / "wrapper.zip", prefix="data")

        datasets = inspect_zip(zip_path)
        gdb_layers = [d for d in datasets if d.format == "gdb-vector"]
        assert gdb_layers
        for d in gdb_layers:
            assert d.container_path == "data/sample.gdb"


class TestLayerPackageDetection:
    def test_lpk_with_inner_gdb(self, tmp_path: Path):
        # Build a .gdb, package it as a .lpk (which is itself a ZIP), then
        # wrap that .lpk in an outer bundle ZIP.
        gdb_path = _make_sample_gdb(tmp_path, {"buildings": "Polygon"})
        lpk_path = tmp_path / "myLayer.lpk"
        _zip_directory(gdb_path, lpk_path)

        outer_zip = _make_zip(tmp_path, {"myLayer.lpk": lpk_path.read_bytes()})

        datasets = inspect_zip(outer_zip)
        lpk_inner = [d for d in datasets if d.container_path == "myLayer.lpk"]
        assert lpk_inner, datasets
        # The inner gdb-vector layer should surface, with layer_name encoding
        # the inner gdb path so the bundle processor can resolve it.
        gdb_inner = [d for d in lpk_inner if d.format == "gdb-vector"]
        assert gdb_inner
        for d in gdb_inner:
            assert d.layer_name and "::" in d.layer_name
            assert d.layer_name.endswith("::buildings")

    def test_lpk_with_inner_shapefile(self, tmp_path: Path):
        # Build a minimal shapefile-stub .lpk and outer ZIP
        lpk_path = tmp_path / "shp_layer.lpk"
        with zipfile.ZipFile(lpk_path, "w") as zf:
            zf.writestr("data/parcels.shp", b"shp")
            zf.writestr("data/parcels.shx", b"shx")
            zf.writestr("data/parcels.dbf", b"dbf")
            zf.writestr("data/parcels.prj", b"prj")

        outer_zip = _make_zip(tmp_path, {"shp_layer.lpk": lpk_path.read_bytes()})

        datasets = inspect_zip(outer_zip)
        inner = [d for d in datasets if d.container_path == "shp_layer.lpk"]
        assert inner
        shp = [d for d in inner if d.format == "shapefile"]
        assert shp
        assert shp[0].layer_name == "data/parcels.shp"

    def test_top_level_lpk_uploaded_directly(self, tmp_path: Path):
        # User uploads a .lpk directly (not nested in a wrapper ZIP).
        # inspect_zip is called on the .lpk file itself; since .lpk IS a ZIP,
        # the inner data sources should surface as if it were a normal bundle.
        lpk_path = tmp_path / "direct.lpk"
        with zipfile.ZipFile(lpk_path, "w") as zf:
            zf.writestr("foo.shp", b"shp")
            zf.writestr("foo.shx", b"shx")
            zf.writestr("foo.dbf", b"dbf")
            zf.writestr("foo.prj", b"prj")

        datasets = inspect_zip(lpk_path)
        assert len(datasets) == 1
        assert datasets[0].format == "shapefile"
        assert datasets[0].primary_file == "foo.shp"
