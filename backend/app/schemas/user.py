from datetime import datetime
from enum import Enum
from uuid import UUID
from pydantic import BaseModel, EmailStr, Field


class UserRole(str, Enum):
    admin = "admin"
    editor = "editor"
    viewer = "viewer"


class UserBase(BaseModel):
    email: EmailStr
    full_name: str | None = None


class UserCreate(UserBase):
    password: str


class UserUpdate(BaseModel):
    email: EmailStr | None = None
    full_name: str | None = None
    password: str | None = None


class AdminUserUpdate(BaseModel):
    role: UserRole | None = None
    is_active: bool | None = None
    full_name: str | None = None


class UserResponse(UserBase):
    id: UUID
    is_active: bool
    is_admin: bool
    role: str
    created_at: datetime

    class Config:
        from_attributes = True


class UserInDB(UserResponse):
    hashed_password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8)
