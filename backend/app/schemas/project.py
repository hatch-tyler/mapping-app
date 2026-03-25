from datetime import datetime
from uuid import UUID
from pydantic import BaseModel


class ProjectCreate(BaseModel):
    name: str
    description: str | None = None


class ProjectUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    is_active: bool | None = None


class MemberResponse(BaseModel):
    id: UUID
    user_id: UUID
    role: str
    created_at: datetime
    user_email: str | None = None
    user_name: str | None = None

    class Config:
        from_attributes = True


class ProjectResponse(BaseModel):
    id: UUID
    name: str
    description: str | None
    is_active: bool
    created_by_id: UUID
    created_at: datetime
    updated_at: datetime
    member_count: int = 0
    dataset_count: int = 0

    class Config:
        from_attributes = True


class ProjectDetailResponse(ProjectResponse):
    members: list[MemberResponse] = []


class ProjectListResponse(BaseModel):
    projects: list[ProjectResponse]
    total: int


class AddMemberRequest(BaseModel):
    user_id: UUID
    role: str = "viewer"


class UpdateMemberRequest(BaseModel):
    role: str
