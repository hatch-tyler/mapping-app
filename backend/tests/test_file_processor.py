"""
Tests for file processor service.
"""
import json
import math
import tempfile
import uuid
from pathlib import Path
from unittest.mock import MagicMock, patch, AsyncMock

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.file_processor import FileProcessor, _validate_table_name, file_processor


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
        assert _validate_table_name("table\" OR \"1\"=\"1") is False

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

    @pytest.mark.asyncio
    async def test_process_vector_geojson(
        self, db_session: AsyncSession, geojson_file: Path
    ):
        """Test processing a GeoJSON file."""
        dataset_id = uuid.uuid4()
        processor = FileProcessor()

        with patch.object(processor, '_create_vector_table', new_callable=AsyncMock) as mock_create:
            with patch.object(processor, '_insert_features', new_callable=AsyncMock) as mock_insert:
                result = await processor.process_vector(
                    geojson_file, dataset_id, db_session
                )

        assert result["geometry_type"] == "Point"
        assert result["feature_count"] == 2
        assert len(result["bounds"]) == 4
        assert "table_name" in result
        assert result["table_name"].startswith("vector_data_")

        # Cleanup
        geojson_file.unlink()

    @pytest.mark.asyncio
    async def test_process_vector_empty_file(self, db_session: AsyncSession):
        """Test processing an empty GeoJSON file raises error."""
        empty_geojson = {"type": "FeatureCollection", "features": []}

        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".geojson", delete=False
        ) as f:
            json.dump(empty_geojson, f)
            file_path = Path(f.name)

        processor = FileProcessor()

        with pytest.raises(ValueError, match="File contains no features"):
            await processor.process_vector(file_path, uuid.uuid4(), db_session)

        file_path.unlink()

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
            mock_src.bounds = MagicMock()
            mock_src.bounds.left = -122.5
            mock_src.bounds.bottom = 37.5
            mock_src.bounds.right = -122.0
            mock_src.bounds.top = 38.0
            mock_src.crs = "EPSG:4326"
            mock_src.width = 1000
            mock_src.height = 1000

            mock.open.return_value.__enter__ = MagicMock(return_value=mock_src)
            mock.open.return_value.__exit__ = MagicMock(return_value=False)

            yield mock

    @pytest.mark.asyncio
    async def test_process_raster(self, mock_rasterio):
        """Test processing a raster file."""
        with tempfile.TemporaryDirectory() as temp_dir:
            # Create a dummy input file
            input_file = Path(temp_dir) / "input.tif"
            input_file.touch()

            # Patch the settings
            with patch("app.services.file_processor.settings") as mock_settings:
                mock_settings.RASTER_DIR = temp_dir

                processor = FileProcessor()
                dataset_id = uuid.uuid4()

                with patch("app.services.file_processor.shutil.copy"):
                    result = await processor.process_raster(input_file, dataset_id)

        assert "file_path" in result
        assert "bounds" in result
        assert len(result["bounds"]) == 4
        assert result["crs"] == "EPSG:4326"
        assert result["width"] == 1000
        assert result["height"] == 1000


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
            elif hasattr(v, 'isoformat'):  # datetime, Timestamp, etc.
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
            elif hasattr(v, 'isoformat'):
                processed[k] = v.isoformat()
            elif hasattr(v, 'item'):  # numpy types
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
            elif hasattr(v, 'isoformat'):
                processed[k] = v.isoformat()
            elif hasattr(v, 'item'):
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
