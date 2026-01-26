from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, EmailStr, Field


class RegistrationRequestCreate(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8)
    full_name: str | None = None


class RegistrationRequestResponse(BaseModel):
    id: UUID
    email: str
    full_name: str | None
    status: str
    rejection_reason: str | None = None
    created_at: datetime
    processed_at: datetime | None = None

    class Config:
        from_attributes = True


class RegistrationRequestListResponse(BaseModel):
    requests: list[RegistrationRequestResponse]
    total: int


class RejectRequest(BaseModel):
    reason: str | None = None


class RegistrationSubmitResponse(BaseModel):
    message: str
    email: str
