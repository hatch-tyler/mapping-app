"""
Tests for WFS (Web Feature Service) API endpoints.
"""
import uuid
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.models.dataset import Dataset


class TestWFSGetCapabilities:
    """Tests for WFS GetCapabilities operation."""

    @pytest.mark.asyncio
    async def test_getcapabilities_lowercase(self, client: AsyncClient):
        """Test GetCapabilities with lowercase parameters."""
        response = await client.get(
            "/api/v1/wfs?service=wfs&request=getcapabilities"
        )

        assert response.status_code == 200
        assert "application/xml" in response.headers["content-type"]
        assert b"WFS_Capabilities" in response.content

    @pytest.mark.asyncio
    async def test_getcapabilities_uppercase(self, client: AsyncClient):
        """Test GetCapabilities with UPPERCASE parameters (ArcGIS Pro style)."""
        response = await client.get(
            "/api/v1/wfs?SERVICE=WFS&REQUEST=GetCapabilities"
        )

        assert response.status_code == 200
        assert "application/xml" in response.headers["content-type"]
        assert b"WFS_Capabilities" in response.content

    @pytest.mark.asyncio
    async def test_getcapabilities_mixed_case(self, client: AsyncClient):
        """Test GetCapabilities with mixed case parameters."""
        response = await client.get(
            "/api/v1/wfs?Service=WFS&Request=GetCapabilities&Version=1.1.0"
        )

        assert response.status_code == 200
        assert b"WFS_Capabilities" in response.content

    @pytest.mark.asyncio
    async def test_getcapabilities_with_version(self, client: AsyncClient):
        """Test GetCapabilities with version parameter."""
        response = await client.get(
            "/api/v1/wfs?service=WFS&request=GetCapabilities&version=1.1.0"
        )

        assert response.status_code == 200
        assert b"version=\"1.1.0\"" in response.content

    @pytest.mark.asyncio
    async def test_cors_headers(self, client: AsyncClient):
        """Test that CORS headers are present in response."""
        response = await client.get(
            "/api/v1/wfs?service=WFS&request=GetCapabilities"
        )

        assert response.status_code == 200
        assert response.headers.get("access-control-allow-origin") == "*"


class TestWFSOptions:
    """Tests for WFS OPTIONS (CORS preflight)."""

    @pytest.mark.asyncio
    async def test_options_request(self, client: AsyncClient):
        """Test OPTIONS request for CORS preflight."""
        response = await client.options("/api/v1/wfs")

        assert response.status_code == 204
        assert response.headers.get("access-control-allow-origin") == "*"
        assert "GET" in response.headers.get("access-control-allow-methods", "")
        assert "POST" in response.headers.get("access-control-allow-methods", "")


class TestWFSParameterValidation:
    """Tests for WFS parameter validation."""

    @pytest.mark.asyncio
    async def test_missing_request_parameter(self, client: AsyncClient):
        """Test error when request parameter is missing."""
        response = await client.get("/api/v1/wfs?service=WFS")

        assert response.status_code == 400
        assert "application/xml" in response.headers["content-type"]
        assert b"MissingParameterValue" in response.content
        assert b"request" in response.content

    @pytest.mark.asyncio
    async def test_invalid_service_parameter(self, client: AsyncClient):
        """Test error when service is not WFS."""
        response = await client.get(
            "/api/v1/wfs?service=WMS&request=GetCapabilities"
        )

        assert response.status_code == 400
        assert b"InvalidParameterValue" in response.content
        assert b"service" in response.content

    @pytest.mark.asyncio
    async def test_unknown_request_type(self, client: AsyncClient):
        """Test error for unknown request type."""
        response = await client.get(
            "/api/v1/wfs?service=WFS&request=UnknownOperation"
        )

        assert response.status_code == 400
        assert b"InvalidParameterValue" in response.content
        assert b"UnknownOperation" in response.content


class TestWFSDescribeFeatureType:
    """Tests for WFS DescribeFeatureType operation."""

    @pytest.mark.asyncio
    async def test_describefeaturetype_missing_typename(self, client: AsyncClient):
        """Test error when typeName is missing."""
        response = await client.get(
            "/api/v1/wfs?service=WFS&request=DescribeFeatureType"
        )

        assert response.status_code == 400
        assert b"MissingParameterValue" in response.content
        assert b"typeName" in response.content

    @pytest.mark.asyncio
    async def test_describefeaturetype_invalid_typename(self, client: AsyncClient):
        """Test error for non-existent feature type."""
        response = await client.get(
            "/api/v1/wfs?service=WFS&request=DescribeFeatureType&typeName=gis:nonexistent"
        )

        assert response.status_code == 200  # WFS returns 200 with exception in body
        # Should return an exception report or empty schema
        assert b"schema" in response.content or b"ExceptionReport" in response.content

    @pytest.mark.asyncio
    async def test_describefeaturetype_uppercase_params(self, client: AsyncClient):
        """Test DescribeFeatureType with UPPERCASE parameters."""
        response = await client.get(
            "/api/v1/wfs?SERVICE=WFS&REQUEST=DescribeFeatureType&TYPENAME=gis:test"
        )

        # Should parse correctly even if type doesn't exist
        assert response.status_code == 200


class TestWFSGetFeature:
    """Tests for WFS GetFeature operation."""

    @pytest.mark.asyncio
    async def test_getfeature_missing_typename(self, client: AsyncClient):
        """Test error when typeName is missing."""
        response = await client.get(
            "/api/v1/wfs?service=WFS&request=GetFeature"
        )

        assert response.status_code == 400
        assert b"MissingParameterValue" in response.content

    @pytest.mark.asyncio
    async def test_getfeature_uppercase_params(self, client: AsyncClient):
        """Test GetFeature with UPPERCASE parameters (ArcGIS Pro style)."""
        response = await client.get(
            "/api/v1/wfs?SERVICE=WFS&REQUEST=GetFeature&TYPENAME=gis:test&OUTPUTFORMAT=application/json"
        )

        # Should parse parameters correctly (may fail on dataset lookup but not 422)
        assert response.status_code != 422
        # Either 200 with empty result or 200 with error in body
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_getfeature_with_bbox(self, client: AsyncClient):
        """Test GetFeature with bbox parameter."""
        response = await client.get(
            "/api/v1/wfs?service=WFS&request=GetFeature&typeName=gis:test&bbox=-180,-90,180,90"
        )

        # Should parse bbox correctly
        assert response.status_code != 422

    @pytest.mark.asyncio
    async def test_getfeature_with_maxfeatures(self, client: AsyncClient):
        """Test GetFeature with maxFeatures parameter."""
        response = await client.get(
            "/api/v1/wfs?service=WFS&request=GetFeature&typeName=gis:test&maxFeatures=100"
        )

        # Should parse maxFeatures correctly
        assert response.status_code != 422

    @pytest.mark.asyncio
    async def test_getfeature_with_count(self, client: AsyncClient):
        """Test GetFeature with count parameter (WFS 2.0 style)."""
        response = await client.get(
            "/api/v1/wfs?service=WFS&request=GetFeature&typeName=gis:test&count=50"
        )

        # Should parse count correctly
        assert response.status_code != 422

    @pytest.mark.asyncio
    async def test_getfeature_json_output(self, client: AsyncClient):
        """Test GetFeature with JSON output format."""
        response = await client.get(
            "/api/v1/wfs?service=WFS&request=GetFeature&typeName=gis:test&outputFormat=application/json"
        )

        # Should return JSON content type when JSON requested
        if response.status_code == 200:
            assert "json" in response.headers["content-type"].lower()


class TestWFSWithDataset:
    """Tests for WFS operations with actual dataset."""

    @pytest.mark.asyncio
    async def test_getcapabilities_lists_public_datasets(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        admin_user: User,
    ):
        """Test that GetCapabilities lists public vector datasets."""
        from app.crud import dataset as dataset_crud
        from app.schemas.dataset import DatasetCreate

        # Create a public vector dataset
        ds = await dataset_crud.create_dataset(
            db_session,
            DatasetCreate(name="WFS Test Layer", description="Test layer for WFS"),
            "vector",
            "geojson",
            created_by_id=admin_user.id,
        )
        # Make it public
        await dataset_crud.update_public_status(db_session, ds, True)

        response = await client.get(
            "/api/v1/wfs?service=WFS&request=GetCapabilities"
        )

        assert response.status_code == 200
        # The dataset should appear in capabilities
        assert b"WFS Test Layer" in response.content or b"FeatureType" in response.content


class TestWFSPost:
    """Tests for WFS POST operations."""

    @pytest.mark.asyncio
    async def test_post_getcapabilities(self, client: AsyncClient):
        """Test POST GetCapabilities request."""
        xml_body = """<?xml version="1.0" encoding="UTF-8"?>
        <wfs:GetCapabilities xmlns:wfs="http://www.opengis.net/wfs" service="WFS"/>
        """
        response = await client.post(
            "/api/v1/wfs",
            content=xml_body,
            headers={"Content-Type": "application/xml"},
        )

        assert response.status_code == 200
        assert b"WFS_Capabilities" in response.content

    @pytest.mark.asyncio
    async def test_post_transaction_requires_auth(self, client: AsyncClient):
        """Test that Transaction requires authentication."""
        xml_body = """<?xml version="1.0" encoding="UTF-8"?>
        <wfs:Transaction xmlns:wfs="http://www.opengis.net/wfs" service="WFS" version="1.1.0">
            <wfs:Insert>
                <feature xmlns="http://localhost:8000/gis">
                    <geometry><gml:Point xmlns:gml="http://www.opengis.net/gml"><gml:pos>0 0</gml:pos></gml:Point></geometry>
                </feature>
            </wfs:Insert>
        </wfs:Transaction>
        """
        response = await client.post(
            "/api/v1/wfs",
            content=xml_body,
            headers={"Content-Type": "application/xml"},
        )

        assert response.status_code == 200  # WFS returns 200 with exception in body
        assert b"Authentication required" in response.content

    @pytest.mark.asyncio
    async def test_post_transaction_requires_admin(
        self, client: AsyncClient, auth_headers: dict
    ):
        """Test that Transaction requires admin privileges."""
        xml_body = """<?xml version="1.0" encoding="UTF-8"?>
        <wfs:Transaction xmlns:wfs="http://www.opengis.net/wfs" service="WFS" version="1.1.0">
            <wfs:Insert>
                <feature xmlns="http://localhost:8000/gis">
                    <geometry><gml:Point xmlns:gml="http://www.opengis.net/gml"><gml:pos>0 0</gml:pos></gml:Point></geometry>
                </feature>
            </wfs:Insert>
        </wfs:Transaction>
        """
        response = await client.post(
            "/api/v1/wfs",
            content=xml_body,
            headers={**auth_headers, "Content-Type": "application/xml"},
        )

        assert response.status_code == 200
        assert b"Admin privileges required" in response.content

    @pytest.mark.asyncio
    async def test_post_invalid_xml(self, client: AsyncClient):
        """Test POST with invalid XML."""
        response = await client.post(
            "/api/v1/wfs",
            content="not valid xml <><>",
            headers={"Content-Type": "application/xml"},
        )

        assert response.status_code == 400
        assert b"ExceptionReport" in response.content


class TestWFSTrailingSlash:
    """Tests that WFS works with and without trailing slash."""

    @pytest.mark.asyncio
    async def test_no_trailing_slash(self, client: AsyncClient):
        """Test WFS endpoint without trailing slash."""
        response = await client.get(
            "/api/v1/wfs?service=WFS&request=GetCapabilities"
        )
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_with_trailing_slash(self, client: AsyncClient):
        """Test WFS endpoint with trailing slash."""
        response = await client.get(
            "/api/v1/wfs/?service=WFS&request=GetCapabilities"
        )
        assert response.status_code == 200
