"""
Tests for file processor service.
"""

import json
import math
import tempfile
import tracemalloc
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.file_processor import (
    FileProcessor,
    _iter_vector_chunks,
    _merge_bounds,
    _strip_z,
    _validate_table_name,
)


class TestTableNameValidation:
    """Tests for table name validation."""

    def test_valid_table_name(self):
        """Test valid table names."""
        assert _validate_table_name("vector_data_123") is True
        assert _validate_table_name("my_table") is True
        assert _validate_table_name("Table123") is True
        assert _validate_table_name("_private") is True

    def test_invalid_table_name_starts_with_number(self):
        """Test table names starting with number are invalid."""
        assert _validate_table_name("123_table") is False

    def test_invalid_table_name_special_chars(self):
        """Test table names with special characters are invalid."""
        assert _validate_table_name("table-name") is False
        assert _validate_table_name("table.name") is False
        assert _validate_table_name("table name") is False
        assert _validate_table_name("table;drop") is False
        assert _validate_table_name("table'quote") is False

    def test_invalid_table_name_sql_injection(self):
        """Test SQL injection attempts are caught."""
        assert _validate_table_name("table; DROP TABLE users;--") is False
        assert _validate_table_name('table" OR "1"="1') is False

    def test_empty_table_name(self):
        """Test empty table name is invalid."""
        assert _validate_table_name("") is False


class TestFileProcessorHelpers:
    """Tests for FileProcessor helper methods."""

    def test_get_file_extension(self):
        """Test extracting file extensions."""
        assert FileProcessor.get_file_extension("file.geojson") == ".geojson"
        assert FileProcessor.get_file_extension("file.GeoJSON") == ".geojson"
        assert FileProcessor.get_file_extension("file.shp") == ".shp"
        assert FileProcessor.get_file_extension("path/to/file.gpkg") == ".gpkg"
        assert FileProcessor.get_file_extension("noextension") == ""

    def test_is_vector_file(self):
        """Test vector file detection."""
        assert FileProcessor.is_vector_file("data.geojson") is True
        assert FileProcessor.is_vector_file("data.json") is True
        assert FileProcessor.is_vector_file("data.shp") is True
        assert FileProcessor.is_vector_file("data.gpkg") is True
        assert FileProcessor.is_vector_file("data.zip") is True
        assert FileProcessor.is_vector_file("data.tif") is False
        assert FileProcessor.is_vector_file("data.csv") is False

    def test_is_raster_file(self):
        """Test raster file detection."""
        assert FileProcessor.is_raster_file("data.tif") is True
        assert FileProcessor.is_raster_file("data.tiff") is True
        assert FileProcessor.is_raster_file("data.geotiff") is True
        assert FileProcessor.is_raster_file("data.TIF") is True
        assert FileProcessor.is_raster_file("data.geojson") is False
        assert FileProcessor.is_raster_file("data.png") is False

    def test_container_extensions_listed(self):
        """Container formats are tracked separately from vector/raster sets."""
        assert FileProcessor.SUPPORTED_CONTAINER == {".gdb", ".lpk", ".lpkx"}
        # Container extensions must NOT collide with the vector single-file
        # uploaders (.lpk/.lpkx flow through the bundle path, not /upload/vector).
        assert FileProcessor.SUPPORTED_CONTAINER.isdisjoint(
            FileProcessor.SUPPORTED_VECTOR
        )
        assert FileProcessor.SUPPORTED_CONTAINER.isdisjoint(
            FileProcessor.SUPPORTED_RASTER
        )


class TestExtractMembersPreservingTree:
    """Tests for extract_members_preserving_tree, used for .gdb / .lpk extraction."""

    def test_preserves_subdirectories(self, tmp_path: Path):
        import zipfile

        zip_path = tmp_path / "src.zip"
        with zipfile.ZipFile(zip_path, "w") as zf:
            zf.writestr("foo/bar/a.txt", b"a")
            zf.writestr("foo/bar/b.txt", b"b")
            zf.writestr("foo/c.txt", b"c")

        dest = tmp_path / "out"
        FileProcessor.extract_members_preserving_tree(
            zip_path, ["foo/bar/a.txt", "foo/bar/b.txt"], dest
        )
        assert (dest / "foo" / "bar" / "a.txt").read_bytes() == b"a"
        assert (dest / "foo" / "bar" / "b.txt").read_bytes() == b"b"
        # Member not in the list should not be extracted.
        assert not (dest / "foo" / "c.txt").exists()


class TestFileProcessorVector:
    """Tests for vector file processing."""

    @pytest.fixture
    def geojson_file(self, sample_geojson: dict) -> Path:
        """Create a temporary GeoJSON file."""
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".geojson", delete=False
        ) as f:
            json.dump(sample_geojson, f)
            return Path(f.name)

    def test_extract_gpkg_metadata_returns_empty_for_non_gpkg(self, tmp_path: Path):
        """Non-GeoPackage files return empty metadata, no exception."""
        f = tmp_path / "x.geojson"
        f.write_text("{}")
        assert FileProcessor._extract_gpkg_metadata(f) == {}

    def test_extract_gpkg_metadata_handles_missing_table(self, tmp_path: Path):
        """GeoPackage without a gpkg_metadata table returns empty dict."""
        import sqlite3

        f = tmp_path / "x.gpkg"
        # Make a valid SQLite file with no metadata table.
        conn = sqlite3.connect(str(f))
        conn.execute("CREATE TABLE other (id INTEGER)")
        conn.commit()
        conn.close()
        assert FileProcessor._extract_gpkg_metadata(f) == {}

    def test_extract_gpkg_metadata_reads_row(self, tmp_path: Path):
        """When gpkg_metadata exists, the first row's scope + content surface."""
        import sqlite3

        f = tmp_path / "x.gpkg"
        conn = sqlite3.connect(str(f))
        conn.execute(
            "CREATE TABLE gpkg_metadata (id INTEGER, md_scope TEXT, metadata TEXT)"
        )
        conn.execute(
            "INSERT INTO gpkg_metadata VALUES (1, 'dataset', '<meta>x</meta>')"
        )
        conn.commit()
        conn.close()
        out = FileProcessor._extract_gpkg_metadata(f)
        assert out == {
            "gpkg_metadata_scope": "dataset",
            "gpkg_metadata": "<meta>x</meta>",
        }

    def test_extract_fgdc_xml_returns_empty_when_no_xml(self, tmp_path: Path):
        f = tmp_path / "x.shp"
        f.write_bytes(b"")
        assert FileProcessor._extract_fgdc_xml(f) == {}

    def test_extract_fgdc_xml_pulls_abstract_purpose_origin(self, tmp_path: Path):
        f = tmp_path / "x.shp"
        f.write_bytes(b"")
        (tmp_path / "x.shp.xml").write_text(
            "<metadata><idinfo>"
            "<descript><abstract>An abstract</abstract>"
            "<purpose>A purpose</purpose></descript>"
            "<citation><citeinfo><origin>An origin</origin></citeinfo></citation>"
            "</idinfo></metadata>"
        )
        out = FileProcessor._extract_fgdc_xml(f)
        assert out["abstract"] == "An abstract"
        assert out["purpose"] == "A purpose"
        assert out["origin"] == "An origin"

    @pytest.mark.asyncio
    async def test_create_vector_table_validates_name(self, db_session: AsyncSession):
        """Test that table creation validates table name."""
        processor = FileProcessor()

        with pytest.raises(ValueError, match="Invalid table name"):
            await processor._create_vector_table(db_session, "invalid;name")

    @pytest.mark.asyncio
    async def test_insert_features_validates_name(self, db_session: AsyncSession):
        """Test that feature insertion validates table name."""
        processor = FileProcessor()
        mock_gdf = MagicMock()

        with pytest.raises(ValueError, match="Invalid table name"):
            await processor._insert_features(db_session, "invalid;name", mock_gdf)


class TestFileProcessorRaster:
    """Tests for raster file processing."""

    @pytest.fixture
    def mock_rasterio(self):
        """Mock rasterio for testing."""
        with patch("app.services.file_processor.rasterio") as mock:
            mock_src = MagicMock()
            # Use a namedtuple-like object so list(src.bounds) works
            from collections import namedtuple

            BoundingBox = namedtuple("BoundingBox", ["left", "bottom", "right", "top"])
            mock_src.bounds = BoundingBox(
                left=-122.5, bottom=37.5, right=-122.0, top=38.0
            )
            mock_crs = MagicMock()
            mock_crs.to_epsg.return_value = 4326
            mock_crs.__str__ = lambda self: "EPSG:4326"
            mock_crs.__bool__ = lambda self: True
            mock_src.crs = mock_crs
            mock_src.width = 1000
            mock_src.height = 1000
            mock_src.count = 1
            mock_src.dtypes = ("uint8",)
            mock_src.nodata = None
            mock_src.profile = {
                "driver": "GTiff",
                "dtype": "uint8",
                "width": 1000,
                "height": 1000,
                "count": 1,
            }
            mock_src.colormap.side_effect = ValueError("No colormap")
            mock_src.read.return_value = MagicMock()

            mock.open.return_value.__enter__ = MagicMock(return_value=mock_src)
            mock.open.return_value.__exit__ = MagicMock(return_value=False)

            yield mock

    def test_process_raster_sync(self, mock_rasterio):
        """The sync raster core produces a COG plus WGS84 bounds metadata."""
        with tempfile.TemporaryDirectory() as temp_dir:
            input_file = Path(temp_dir) / "input.tif"
            input_file.touch()

            with patch("app.services.file_processor.settings") as mock_settings:
                mock_settings.RASTER_DIR = temp_dir

                processor = FileProcessor()
                dataset_id = uuid.uuid4()

                # Exercises _process_raster_sync directly — the sync
                # process_raster wrapper was removed in PR 2.
                result = processor._process_raster_sync(input_file, dataset_id)

        assert "file_path" in result
        assert "bounds_wgs84" in result
        assert len(result["bounds_wgs84"]) == 4
        assert "metadata" in result
        assert result["metadata"]["band_count"] == 1


class TestNaNHandling:
    """Tests for NaN value handling in properties."""

    def test_nan_detection(self):
        """Test that NaN values are properly detected."""
        import math

        # These should be detected as NaN
        assert math.isnan(float("nan"))
        assert not math.isnan(0.0)
        assert not math.isnan(1.5)
        assert not math.isnan(-1.0)

    @pytest.mark.asyncio
    async def test_properties_with_nan_values(self):
        """Test that NaN values in properties are converted to None."""
        properties = {
            "name": "Test",
            "value": float("nan"),
            "count": 5,
            "ratio": 0.5,
        }

        # Simulate the NaN handling from file_processor
        processed = {}
        for k, v in properties.items():
            if isinstance(v, float) and math.isnan(v):
                processed[k] = None
            else:
                processed[k] = v

        assert processed["name"] == "Test"
        assert processed["value"] is None
        assert processed["count"] == 5
        assert processed["ratio"] == 0.5

        # Verify it can be JSON serialized
        json_str = json.dumps(processed)
        assert "null" in json_str


class TestTimestampHandling:
    """Tests for Timestamp and datetime handling in properties."""

    @pytest.mark.asyncio
    async def test_properties_with_timestamp_values(self):
        """Test that Timestamp/datetime values are converted to ISO format strings."""
        from datetime import datetime
        import pandas as pd

        # Simulate properties with various datetime types
        timestamp = pd.Timestamp("2024-01-15 10:30:00")
        dt = datetime(2024, 1, 15, 10, 30, 0)

        properties = {
            "name": "Test",
            "pandas_timestamp": timestamp,
            "python_datetime": dt,
            "regular_value": 42,
        }

        # Simulate the isoformat handling from file_processor
        processed = {}
        for k, v in properties.items():
            if v is None:
                processed[k] = None
            elif isinstance(v, float) and math.isnan(v):
                processed[k] = None
            elif hasattr(v, "isoformat"):  # datetime, Timestamp, etc.
                processed[k] = v.isoformat()
            else:
                processed[k] = v

        assert processed["name"] == "Test"
        assert processed["pandas_timestamp"] == "2024-01-15T10:30:00"
        assert processed["python_datetime"] == "2024-01-15T10:30:00"
        assert processed["regular_value"] == 42

        # Verify it can be JSON serialized
        json_str = json.dumps(processed)
        assert "2024-01-15T10:30:00" in json_str

    @pytest.mark.asyncio
    async def test_properties_with_numpy_values(self):
        """Test that numpy values are converted to Python native types."""
        import numpy as np

        properties = {
            "name": "Test",
            "np_int": np.int64(42),
            "np_float": np.float64(3.14),
            "np_bool": np.bool_(True),
            "regular_int": 10,
        }

        # Simulate the numpy handling from file_processor
        processed = {}
        for k, v in properties.items():
            if v is None:
                processed[k] = None
            elif isinstance(v, float) and math.isnan(v):
                processed[k] = None
            elif hasattr(v, "isoformat"):
                processed[k] = v.isoformat()
            elif hasattr(v, "item"):  # numpy types
                processed[k] = v.item()
            else:
                processed[k] = v

        assert processed["name"] == "Test"
        assert processed["np_int"] == 42
        assert isinstance(processed["np_int"], int)
        assert processed["np_float"] == 3.14
        assert isinstance(processed["np_float"], float)
        assert processed["np_bool"] is True
        assert processed["regular_int"] == 10

        # Verify it can be JSON serialized
        json_str = json.dumps(processed)
        assert "42" in json_str
        assert "3.14" in json_str

    @pytest.mark.asyncio
    async def test_mixed_special_values(self):
        """Test handling of mixed special values in properties."""
        from datetime import datetime
        import numpy as np

        properties = {
            "string_val": "Hello",
            "none_val": None,
            "nan_val": float("nan"),
            "datetime_val": datetime(2024, 6, 15, 12, 0, 0),
            "np_val": np.int32(100),
            "list_val": [1, 2, 3],
        }

        # Simulate the complete handling from file_processor
        processed = {}
        for k, v in properties.items():
            if v is None:
                processed[k] = None
            elif isinstance(v, float) and math.isnan(v):
                processed[k] = None
            elif hasattr(v, "isoformat"):
                processed[k] = v.isoformat()
            elif hasattr(v, "item"):
                processed[k] = v.item()
            else:
                processed[k] = v

        assert processed["string_val"] == "Hello"
        assert processed["none_val"] is None
        assert processed["nan_val"] is None
        assert processed["datetime_val"] == "2024-06-15T12:00:00"
        assert processed["np_val"] == 100
        assert processed["list_val"] == [1, 2, 3]

        # Verify it can be JSON serialized
        json_str = json.dumps(processed)
        assert '"string_val": "Hello"' in json_str or '"string_val":"Hello"' in json_str


def _write_geojson(path: Path, n_features: int, *, crs: str = "EPSG:4326") -> None:
    """Write a small GeoJSON FeatureCollection of N point features.

    Coordinates are spaced so total_bounds spans a known box, useful for
    asserting bounds-merge correctness.
    """
    pytest.importorskip("geopandas")
    pytest.importorskip("shapely")
    import geopandas as gpd
    from shapely.geometry import Point

    gdf = gpd.GeoDataFrame(
        {"id": list(range(n_features))},
        geometry=[Point(i * 0.001, i * 0.001) for i in range(n_features)],
        crs=crs,
    )
    gdf.to_file(str(path), driver="GeoJSON")


class TestIterVectorChunks:
    """Streaming chunk reader — bounds memory by chunk size, not file size."""

    def test_yields_all_features(self, tmp_path: Path):
        path = tmp_path / "many.geojson"
        _write_geojson(path, 1005)
        info, chunks = _iter_vector_chunks(path, chunk_size=200)
        assert info.feature_count == 1005

        chunks_list = list(chunks)
        # 1005 / 200 = 5 full chunks of 200 + 1 partial chunk of 5.
        assert [len(c) for c in chunks_list] == [200, 200, 200, 200, 200, 5]
        # Every feature accounted for.
        assert sum(len(c) for c in chunks_list) == 1005

    def test_preserves_crs_per_chunk(self, tmp_path: Path):
        path = tmp_path / "mercator.geojson"
        _write_geojson(path, 50, crs="EPSG:3857")
        info, chunks = _iter_vector_chunks(path, chunk_size=20)
        # info.crs is whatever pyogrio returns; we just need to confirm
        # the source CRS is non-null. Reprojection is the caller's job.
        assert info.crs is not None
        for chunk in chunks:
            assert chunk.crs is not None
            assert chunk.crs.to_epsg() == 3857

    def test_empty_file_yields_no_chunks(self, tmp_path: Path):
        path = tmp_path / "empty.geojson"
        path.write_text(json.dumps({"type": "FeatureCollection", "features": []}))
        info, chunks = _iter_vector_chunks(path, chunk_size=100)
        assert info.feature_count == 0
        assert list(chunks) == []

    def test_chunk_size_larger_than_total_yields_one_chunk(self, tmp_path: Path):
        path = tmp_path / "small.geojson"
        _write_geojson(path, 7)
        info, chunks = _iter_vector_chunks(path, chunk_size=1000)
        assert info.feature_count == 7
        chunks_list = list(chunks)
        assert len(chunks_list) == 1
        assert len(chunks_list[0]) == 7


class TestMergeBounds:
    def test_first_chunk_initialises_acc(self):
        result = _merge_bounds(None, [10.0, 20.0, 30.0, 40.0])
        assert result == [10.0, 20.0, 30.0, 40.0]

    def test_expands_in_each_direction(self):
        # acc is the initial bounds; chunk is wider in every dimension.
        acc = [10.0, 20.0, 15.0, 25.0]
        chunk = [5.0, 10.0, 30.0, 35.0]
        assert _merge_bounds(acc, chunk) == [5.0, 10.0, 30.0, 35.0]

    def test_chunk_inside_acc_does_not_shrink(self):
        # A chunk fully contained within acc should leave acc unchanged.
        acc = [0.0, 0.0, 100.0, 100.0]
        chunk = [25.0, 25.0, 75.0, 75.0]
        assert _merge_bounds(acc, chunk) == [0.0, 0.0, 100.0, 100.0]

    def test_accepts_numpy_array_chunk(self):
        # GeoDataFrame.total_bounds returns a numpy array; verify that
        # works (the function calls float() on each entry).
        np = pytest.importorskip("numpy")
        chunk = np.array([1.0, 2.0, 3.0, 4.0])
        assert _merge_bounds(None, chunk) == [1.0, 2.0, 3.0, 4.0]


class TestStripZ:
    def test_strips_z_from_3d_point(self):
        from shapely.geometry import Point

        p3d = Point(1.0, 2.0, 3.0)
        assert p3d.has_z is True

        p2d = _strip_z(p3d)
        assert p2d.has_z is False
        assert (p2d.x, p2d.y) == (1.0, 2.0)

    def test_passes_through_2d_geometry(self):
        from shapely.geometry import Point

        p = Point(1.0, 2.0)
        assert _strip_z(p) is p

    def test_handles_none(self):
        assert _strip_z(None) is None


class TestProcessVectorBackgroundChunked:
    """End-to-end smoke tests for the chunked processing flow."""

    @pytest.mark.asyncio
    async def test_streams_a_synthetic_dataset_in_chunks(self, tmp_path: Path):
        """A 2 500-feature file is processed in chunks of 1 000 — the
        insert helper is called 3 times (1 000 + 1 000 + 500), each time
        with a non-overlapping cumulative_offset. Tracemalloc confirms
        peak memory is bounded — orders of magnitude smaller than what
        a single whole-layer read would produce."""
        path = tmp_path / "many.geojson"
        _write_geojson(path, 2500)

        processor = FileProcessor()
        insert_calls: list[dict] = []

        async def fake_insert(
            db, table_name, gdf, **kwargs
        ):  # pylint: disable=unused-argument
            insert_calls.append(
                {
                    "n": len(gdf),
                    "cumulative_offset": kwargs.get("cumulative_offset"),
                    "grand_total": kwargs.get("grand_total"),
                }
            )

        class _FakeSessionCM:
            def __init__(self):
                self.session = MagicMock()
                self.session.execute = AsyncMock()
                self.session.commit = AsyncMock()

            async def __aenter__(self):
                return self.session

            async def __aexit__(self, exc_type, exc_val, exc_tb):
                return False

        with (
            patch("app.services.file_processor._VECTOR_CHUNK_SIZE", 1000),
            patch.object(processor, "_create_vector_table", new_callable=AsyncMock),
            patch.object(
                processor, "_insert_features_batched", side_effect=fake_insert
            ),
            patch(
                "app.services.file_processor.AsyncSessionLocal",
                side_effect=lambda: _FakeSessionCM(),
            ),
            patch("app.crud.dataset.get_upload_job", new_callable=AsyncMock),
            patch("app.crud.dataset.update_upload_job", new_callable=AsyncMock),
            patch("app.crud.dataset.get_dataset", new_callable=AsyncMock),
        ):
            tracemalloc.start()
            await processor.process_vector_background(path, uuid.uuid4(), uuid.uuid4())
            _, peak = tracemalloc.get_traced_memory()
            tracemalloc.stop()

        # Exactly 3 chunks: 1 000 + 1 000 + 500.
        assert [c["n"] for c in insert_calls] == [1000, 1000, 500]
        # Cumulative offsets are non-overlapping.
        assert [c["cumulative_offset"] for c in insert_calls] == [0, 1000, 2000]
        # All chunks share the same grand_total (the full feature count).
        assert all(c["grand_total"] == 2500 for c in insert_calls)
        # Peak Python allocation is comfortably bounded — chunked.
        assert peak < 100 * 1024 * 1024, f"Peak memory too high: {peak} bytes"

    @pytest.mark.asyncio
    async def test_drops_orphan_table_when_chunk_insert_fails(self, tmp_path: Path):
        """If the second chunk's insert raises, the partially-populated
        vector_data_<uuid> table is dropped in the exception handler.
        The exception handler opens a fresh AsyncSessionLocal as
        ``err_db``; we capture all SQL executed against it and assert
        a DROP TABLE landed on the deterministic table name."""
        path = tmp_path / "many.geojson"
        _write_geojson(path, 2500)

        processor = FileProcessor()
        executed_sql: list[str] = []
        call_count = {"n": 0}

        async def flaky_insert(
            db, table_name, gdf, **kwargs
        ):  # pylint: disable=unused-argument
            call_count["n"] += 1
            if call_count["n"] == 2:
                raise RuntimeError("simulated chunk failure")

        # Build a stand-in session whose execute() records SQL. Used
        # both for the main flow (where we mock _create_vector_table
        # and _insert_features_batched) and for the err_db opened
        # inside the except handler.
        def make_session():
            sess = MagicMock()

            async def record_execute(sql, *args, **kwargs):
                executed_sql.append(str(sql))
                return MagicMock()

            sess.execute = AsyncMock(side_effect=record_execute)
            sess.commit = AsyncMock()
            return sess

            # Create AsyncContextManager wrapper.

        class _FakeSessionCM:
            def __init__(self):
                self.session = make_session()

            async def __aenter__(self):
                return self.session

            async def __aexit__(self, exc_type, exc_val, exc_tb):
                return False

        with (
            patch("app.services.file_processor._VECTOR_CHUNK_SIZE", 1000),
            patch.object(processor, "_create_vector_table", new_callable=AsyncMock),
            patch.object(
                processor, "_insert_features_batched", side_effect=flaky_insert
            ),
            patch(
                "app.services.file_processor.AsyncSessionLocal",
                side_effect=lambda: _FakeSessionCM(),
            ),
            patch("app.crud.dataset.get_upload_job", new_callable=AsyncMock),
            patch("app.crud.dataset.update_upload_job", new_callable=AsyncMock),
            patch("app.crud.dataset.get_dataset", new_callable=AsyncMock),
        ):
            await processor.process_vector_background(path, uuid.uuid4(), uuid.uuid4())

        # The exception handler emitted a DROP TABLE for the partial
        # vector_data_<uuid> table.
        drop_statements = [s for s in executed_sql if "DROP TABLE" in s.upper()]
        assert (
            drop_statements
        ), f"Expected DROP TABLE in executed SQL; got: {executed_sql}"
        # Sanity: the dropped table name is the deterministic one.
        assert "vector_data_" in drop_statements[0]
