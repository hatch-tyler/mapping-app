"""Tests for project member management permissions."""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project, ProjectMember
from app.models.user import User
from app.core.security import get_password_hash


@pytest.fixture
async def editor_user(db_session: AsyncSession):
    user = User(
        id=uuid.uuid4(),
        email="editor@test.com",
        hashed_password=get_password_hash("password123"),
        full_name="Editor User",
        is_active=True,
        role="editor",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest.fixture
async def viewer_user(db_session: AsyncSession):
    user = User(
        id=uuid.uuid4(),
        email="viewer@test.com",
        hashed_password=get_password_hash("password123"),
        full_name="Viewer User",
        is_active=True,
        role="viewer",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest.fixture
async def project_with_owner(db_session: AsyncSession, editor_user: User):
    project = Project(
        id=uuid.uuid4(),
        name="Test Project",
        created_by_id=editor_user.id,
    )
    db_session.add(project)
    await db_session.flush()

    member = ProjectMember(
        id=uuid.uuid4(),
        project_id=project.id,
        user_id=editor_user.id,
        role="owner",
    )
    db_session.add(member)
    await db_session.commit()
    await db_session.refresh(project)
    return project


class TestProjectMemberPermissions:
    @pytest.mark.asyncio
    async def test_admin_can_add_member(
        self,
        client: AsyncClient,
        admin_auth_headers: dict,
        project_with_owner: Project,
        viewer_user: User,
    ):
        response = await client.post(
            f"/api/v1/projects/{project_with_owner.id}/members",
            json={"user_id": str(viewer_user.id), "role": "viewer"},
            headers=admin_auth_headers,
        )
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_editor_creator_can_add_member(
        self,
        client: AsyncClient,
        editor_user: User,
        project_with_owner: Project,
        viewer_user: User,
    ):
        from app.core.security import create_access_token

        token = create_access_token(subject=str(editor_user.id))
        headers = {"Authorization": f"Bearer {token}"}
        response = await client.post(
            f"/api/v1/projects/{project_with_owner.id}/members",
            json={"user_id": str(viewer_user.id), "role": "viewer"},
            headers=headers,
        )
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_viewer_non_owner_cannot_add_member(
        self,
        client: AsyncClient,
        viewer_user: User,
        project_with_owner: Project,
        admin_user: User,
    ):
        from app.core.security import create_access_token

        token = create_access_token(subject=str(viewer_user.id))
        headers = {"Authorization": f"Bearer {token}"}
        response = await client.post(
            f"/api/v1/projects/{project_with_owner.id}/members",
            json={"user_id": str(admin_user.id), "role": "viewer"},
            headers=headers,
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_viewer_project_owner_can_add_member(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        viewer_user: User,
        admin_user: User,
    ):
        """A viewer who is project-level owner should be able to add members."""
        from app.core.security import create_access_token

        # Create project owned by viewer
        project = Project(
            id=uuid.uuid4(),
            name="Viewer's Project",
            created_by_id=viewer_user.id,
        )
        db_session.add(project)
        await db_session.flush()
        member = ProjectMember(
            id=uuid.uuid4(),
            project_id=project.id,
            user_id=viewer_user.id,
            role="owner",
        )
        db_session.add(member)
        await db_session.commit()

        token = create_access_token(subject=str(viewer_user.id))
        headers = {"Authorization": f"Bearer {token}"}
        response = await client.post(
            f"/api/v1/projects/{project.id}/members",
            json={"user_id": str(admin_user.id), "role": "editor"},
            headers=headers,
        )
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_unauthenticated_cannot_add_member(
        self, client: AsyncClient, project_with_owner: Project
    ):
        response = await client.post(
            f"/api/v1/projects/{project_with_owner.id}/members",
            json={"user_id": str(uuid.uuid4()), "role": "viewer"},
        )
        assert response.status_code in (401, 403)

    @pytest.mark.asyncio
    async def test_nonexistent_project_returns_404(
        self, client: AsyncClient, admin_auth_headers: dict
    ):
        response = await client.post(
            f"/api/v1/projects/{uuid.uuid4()}/members",
            json={"user_id": str(uuid.uuid4()), "role": "viewer"},
            headers=admin_auth_headers,
        )
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_user_list_accessible_to_non_admins(
        self, client: AsyncClient, editor_user: User
    ):
        """Non-admin users should be able to list users (needed for member dropdown)."""
        from app.core.security import create_access_token

        token = create_access_token(subject=str(editor_user.id))
        headers = {"Authorization": f"Bearer {token}"}
        response = await client.get("/api/v1/users/", headers=headers)
        assert response.status_code == 200
        data = response.json()
        # Non-admins get limited fields
        for user in data:
            assert "id" in user
            assert "email" in user
            assert "is_admin" not in user
