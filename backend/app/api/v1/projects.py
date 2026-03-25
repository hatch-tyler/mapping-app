from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.project import (
    ProjectCreate,
    ProjectUpdate,
    ProjectResponse,
    ProjectDetailResponse,
    ProjectListResponse,
    MemberResponse,
    AddMemberRequest,
    UpdateMemberRequest,
)
from app.crud import project as project_crud
from app.crud import user as user_crud
from app.api.deps import get_current_user, get_current_admin_user
from app.models.user import User

router = APIRouter(prefix="/projects", tags=["projects"])


def _project_to_response(project, member_count: int = 0, dataset_count: int = 0) -> ProjectResponse:
    return ProjectResponse(
        id=project.id,
        name=project.name,
        description=project.description,
        is_active=project.is_active,
        created_by_id=project.created_by_id,
        created_at=project.created_at,
        updated_at=project.updated_at,
        member_count=member_count,
        dataset_count=dataset_count,
    )


def _member_to_response(member) -> MemberResponse:
    return MemberResponse(
        id=member.id,
        user_id=member.user_id,
        role=member.role,
        created_at=member.created_at,
        user_email=member.user.email if member.user else None,
        user_name=member.user.full_name if member.user else None,
    )


@router.post("/", response_model=ProjectResponse)
async def create_project(
    project_in: ProjectCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    project = await project_crud.create_project(db, project_in, current_user.id)
    member_count = await project_crud.get_member_count(db, project.id)
    return _project_to_response(project, member_count=member_count)


@router.get("/", response_model=ProjectListResponse)
async def list_projects(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    projects, total = await project_crud.get_projects(
        db, user_id=current_user.id, is_admin=current_user.is_admin,
        skip=skip, limit=limit,
    )
    counts = await project_crud.get_bulk_counts(db, [p.id for p in projects])
    results = [
        _project_to_response(p, member_count=counts.get(p.id, (0, 0))[0], dataset_count=counts.get(p.id, (0, 0))[1])
        for p in projects
    ]
    return ProjectListResponse(projects=results, total=total)


@router.get("/{project_id}", response_model=ProjectDetailResponse)
async def get_project(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = await project_crud.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    # Check access: admin or member
    if not current_user.is_admin:
        member = await project_crud.get_project_member(db, project_id, current_user.id)
        if not member:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a project member")

    mc = await project_crud.get_member_count(db, project.id)
    dc = await project_crud.get_dataset_count(db, project.id)
    members = [_member_to_response(m) for m in project.members]

    return ProjectDetailResponse(
        id=project.id,
        name=project.name,
        description=project.description,
        is_active=project.is_active,
        created_by_id=project.created_by_id,
        created_at=project.created_at,
        updated_at=project.updated_at,
        member_count=mc,
        dataset_count=dc,
        members=members,
    )


@router.put("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: UUID,
    project_in: ProjectUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    project = await project_crud.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    project = await project_crud.update_project(db, project, project_in)
    mc = await project_crud.get_member_count(db, project.id)
    dc = await project_crud.get_dataset_count(db, project.id)
    return _project_to_response(project, member_count=mc, dataset_count=dc)


@router.delete("/{project_id}")
async def delete_project(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    project = await project_crud.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    await project_crud.delete_project(db, project)
    return {"message": "Project deleted"}


@router.post("/{project_id}/members", response_model=MemberResponse)
async def add_member(
    project_id: UUID,
    request: AddMemberRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    project = await project_crud.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    # Verify user exists
    user = await user_crud.get_user(db, request.user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # Check not already a member
    existing = await project_crud.get_project_member(db, project_id, request.user_id)
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User is already a member")

    if request.role not in ("owner", "editor", "viewer"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid role")

    member = await project_crud.add_member(db, project_id, request.user_id, request.role)
    # Reload with user relationship
    member_full = await project_crud.get_project_member(db, project_id, request.user_id)
    return _member_to_response(member_full or member)


@router.patch("/{project_id}/members/{user_id}", response_model=MemberResponse)
async def update_member(
    project_id: UUID,
    user_id: UUID,
    request: UpdateMemberRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    member = await project_crud.get_project_member(db, project_id, user_id)
    if not member:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")

    if request.role not in ("owner", "editor", "viewer"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid role")

    member = await project_crud.update_member_role(db, member, request.role)
    return _member_to_response(member)


@router.delete("/{project_id}/members/{user_id}")
async def remove_member(
    project_id: UUID,
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    member = await project_crud.get_project_member(db, project_id, user_id)
    if not member:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")

    await project_crud.remove_member(db, member)
    return {"message": "Member removed"}
