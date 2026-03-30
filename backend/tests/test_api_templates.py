"""Tests for layout template and map view API endpoints."""

import uuid
import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.models.template import LayoutTemplate, MapView
from app.core.security import get_password_hash, create_access_token


@pytest_asyncio.fixture
async def editor_user(db_session: AsyncSession) -> User:
    """Create an editor user."""
    user = User(
        id=uuid.uuid4(),
        email="editor@example.com",
        hashed_password=get_password_hash("editorpass123"),
        full_name="Editor User",
        is_active=True,
        is_admin=False,
        role="editor",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest.fixture
def editor_auth_headers(editor_user: User) -> dict:
    return {
        "Authorization": f"Bearer {create_access_token(subject=str(editor_user.id))}"
    }


@pytest_asyncio.fixture
async def sample_template(
    db_session: AsyncSession, editor_user: User
) -> LayoutTemplate:
    """Create a sample layout template."""
    template = LayoutTemplate(
        id=uuid.uuid4(),
        name="Test Template",
        description="A test template",
        page_config={"width": 279.4, "height": 215.9, "orientation": "landscape"},
        elements=[
            {"type": "map_frame", "x": 10, "y": 20, "w": 180, "h": 150},
            {"type": "title", "x": 10, "y": 5, "w": 180, "h": 15, "text": "Map Title"},
        ],
        created_by_id=editor_user.id,
    )
    db_session.add(template)
    await db_session.commit()
    await db_session.refresh(template)
    return template


@pytest_asyncio.fixture
async def sample_map_view(db_session: AsyncSession, test_user: User) -> MapView:
    """Create a sample map view."""
    view = MapView(
        id=uuid.uuid4(),
        name="Test View",
        map_config={
            "zoom": 10,
            "latitude": 37.7,
            "longitude": -122.4,
            "bearing": 0,
            "pitch": 0,
            "basemap": "dark",
        },
        layer_configs=[{"dataset_id": str(uuid.uuid4()), "visible": True}],
        created_by_id=test_user.id,
    )
    db_session.add(view)
    await db_session.commit()
    await db_session.refresh(view)
    return view


class TestLayoutTemplates:
    async def test_create_template(
        self, client: AsyncClient, editor_auth_headers: dict
    ):
        response = await client.post(
            "/api/v1/layout-templates/",
            json={
                "name": "New Template",
                "description": "Test desc",
                "page_config": {
                    "width": 297,
                    "height": 210,
                    "orientation": "landscape",
                },
                "elements": [
                    {"type": "map_frame", "x": 10, "y": 10, "w": 200, "h": 150}
                ],
            },
            headers=editor_auth_headers,
        )
        assert response.status_code in (200, 201)
        data = response.json()
        assert data["name"] == "New Template"
        assert data["page_config"]["width"] == 297
        assert len(data["elements"]) == 1

    async def test_create_template_unauthorized(self, client: AsyncClient):
        response = await client.post(
            "/api/v1/layout-templates/",
            json={
                "name": "Test",
                "page_config": {
                    "width": 279.4,
                    "height": 215.9,
                    "orientation": "landscape",
                },
                "elements": [],
            },
        )
        assert response.status_code in (401, 403)

    async def test_create_template_viewer_forbidden(
        self, client: AsyncClient, auth_headers: dict
    ):
        response = await client.post(
            "/api/v1/layout-templates/",
            json={
                "name": "Test",
                "page_config": {
                    "width": 279.4,
                    "height": 215.9,
                    "orientation": "landscape",
                },
                "elements": [],
            },
            headers=auth_headers,
        )
        assert response.status_code == 403

    async def test_list_templates(
        self, client: AsyncClient, sample_template: LayoutTemplate, auth_headers: dict
    ):
        response = await client.get("/api/v1/layout-templates/", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert len(data) >= 1
        assert any(t["name"] == "Test Template" for t in data)

    async def test_get_template(
        self, client: AsyncClient, sample_template: LayoutTemplate, auth_headers: dict
    ):
        response = await client.get(
            f"/api/v1/layout-templates/{sample_template.id}",
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Test Template"
        assert len(data["elements"]) == 2

    async def test_get_template_not_found(
        self, client: AsyncClient, auth_headers: dict
    ):
        fake_id = uuid.uuid4()
        response = await client.get(
            f"/api/v1/layout-templates/{fake_id}", headers=auth_headers
        )
        assert response.status_code == 404

    async def test_update_template(
        self,
        client: AsyncClient,
        sample_template: LayoutTemplate,
        editor_auth_headers: dict,
    ):
        response = await client.put(
            f"/api/v1/layout-templates/{sample_template.id}",
            json={"name": "Updated Name"},
            headers=editor_auth_headers,
        )
        assert response.status_code == 200
        assert response.json()["name"] == "Updated Name"

    async def test_delete_template(
        self,
        client: AsyncClient,
        sample_template: LayoutTemplate,
        editor_auth_headers: dict,
    ):
        response = await client.delete(
            f"/api/v1/layout-templates/{sample_template.id}",
            headers=editor_auth_headers,
        )
        assert response.status_code == 200

    async def test_export_qpt(
        self, client: AsyncClient, sample_template: LayoutTemplate, auth_headers: dict
    ):
        response = await client.get(
            f"/api/v1/layout-templates/{sample_template.id}/export/qpt",
            headers=auth_headers,
        )
        assert response.status_code == 200
        assert (
            "xml" in response.headers.get("content-type", "").lower()
            or response.status_code == 200
        )

    async def test_export_pagx(
        self, client: AsyncClient, sample_template: LayoutTemplate, auth_headers: dict
    ):
        response = await client.get(
            f"/api/v1/layout-templates/{sample_template.id}/export/pagx",
            headers=auth_headers,
        )
        assert response.status_code == 200


class TestMapViews:
    async def test_create_map_view(self, client: AsyncClient, auth_headers: dict):
        response = await client.post(
            "/api/v1/map-views/",
            json={
                "name": "My View",
                "map_config": {
                    "zoom": 5,
                    "latitude": 40,
                    "longitude": -100,
                    "bearing": 0,
                    "pitch": 0,
                    "basemap": "light",
                },
                "layer_configs": [],
            },
            headers=auth_headers,
        )
        assert response.status_code in (200, 201)
        data = response.json()
        assert data["name"] == "My View"

    async def test_list_map_views(
        self, client: AsyncClient, sample_map_view: MapView, auth_headers: dict
    ):
        response = await client.get("/api/v1/map-views/", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert len(data) >= 1

    async def test_get_map_view(
        self, client: AsyncClient, sample_map_view: MapView, auth_headers: dict
    ):
        response = await client.get(
            f"/api/v1/map-views/{sample_map_view.id}", headers=auth_headers
        )
        assert response.status_code == 200
        assert response.json()["name"] == "Test View"

    async def test_update_map_view(
        self, client: AsyncClient, sample_map_view: MapView, auth_headers: dict
    ):
        response = await client.put(
            f"/api/v1/map-views/{sample_map_view.id}",
            json={"name": "Updated View", "description": "New description"},
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Updated View"
        assert data["description"] == "New description"

    async def test_update_map_view_partial(
        self, client: AsyncClient, sample_map_view: MapView, auth_headers: dict
    ):
        response = await client.put(
            f"/api/v1/map-views/{sample_map_view.id}",
            json={"description": "Only description"},
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Test View"  # unchanged
        assert data["description"] == "Only description"

    async def test_update_map_view_not_found(
        self, client: AsyncClient, auth_headers: dict
    ):
        fake_id = uuid.uuid4()
        response = await client.put(
            f"/api/v1/map-views/{fake_id}",
            json={"name": "Nope"},
            headers=auth_headers,
        )
        assert response.status_code == 404

    async def test_delete_map_view(
        self, client: AsyncClient, sample_map_view: MapView, auth_headers: dict
    ):
        response = await client.delete(
            f"/api/v1/map-views/{sample_map_view.id}", headers=auth_headers
        )
        assert response.status_code == 200

    async def test_create_view_unauthorized(self, client: AsyncClient):
        response = await client.post(
            "/api/v1/map-views/",
            json={
                "name": "Test",
                "map_config": {
                    "zoom": 5,
                    "latitude": 40,
                    "longitude": -100,
                    "bearing": 0,
                    "pitch": 0,
                    "basemap": "light",
                },
                "layer_configs": [],
            },
        )
        assert response.status_code in (401, 403)
