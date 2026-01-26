from datetime import datetime
from uuid import UUID
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.registration import RegistrationRequest
from app.models.user import User
from app.schemas.registration import RegistrationRequestCreate
from app.core.security import get_password_hash


async def get_registration_request(
    db: AsyncSession, request_id: UUID
) -> RegistrationRequest | None:
    result = await db.execute(
        select(RegistrationRequest).where(RegistrationRequest.id == request_id)
    )
    return result.scalar_one_or_none()


async def get_registration_by_email(
    db: AsyncSession, email: str
) -> RegistrationRequest | None:
    result = await db.execute(
        select(RegistrationRequest).where(RegistrationRequest.email == email)
    )
    return result.scalar_one_or_none()


async def get_pending_requests(
    db: AsyncSession, skip: int = 0, limit: int = 100
) -> tuple[list[RegistrationRequest], int]:
    """Get pending registration requests with total count."""
    # Get total count
    count_result = await db.execute(
        select(func.count()).select_from(RegistrationRequest).where(
            RegistrationRequest.status == "pending"
        )
    )
    total = count_result.scalar() or 0

    # Get paginated results
    result = await db.execute(
        select(RegistrationRequest)
        .where(RegistrationRequest.status == "pending")
        .order_by(RegistrationRequest.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    requests = list(result.scalars().all())

    return requests, total


async def get_all_requests(
    db: AsyncSession, skip: int = 0, limit: int = 100
) -> tuple[list[RegistrationRequest], int]:
    """Get all registration requests with total count."""
    count_result = await db.execute(
        select(func.count()).select_from(RegistrationRequest)
    )
    total = count_result.scalar() or 0

    result = await db.execute(
        select(RegistrationRequest)
        .order_by(RegistrationRequest.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    requests = list(result.scalars().all())

    return requests, total


async def create_registration_request(
    db: AsyncSession, request_in: RegistrationRequestCreate
) -> RegistrationRequest:
    """Create a new registration request."""
    registration = RegistrationRequest(
        email=request_in.email,
        hashed_password=get_password_hash(request_in.password),
        full_name=request_in.full_name,
        status="pending",
    )
    db.add(registration)
    await db.commit()
    await db.refresh(registration)
    return registration


async def approve_request(
    db: AsyncSession,
    request: RegistrationRequest,
    admin_id: UUID
) -> User:
    """Approve a registration request and create the user."""
    # Create the user with the stored hashed password
    user = User(
        email=request.email,
        hashed_password=request.hashed_password,
        full_name=request.full_name,
        is_admin=False,
        is_active=True,
    )
    db.add(user)

    # Update the registration request
    request.status = "approved"
    request.processed_at = datetime.utcnow()
    request.processed_by_id = admin_id

    await db.commit()
    await db.refresh(user)
    return user


async def reject_request(
    db: AsyncSession,
    request: RegistrationRequest,
    admin_id: UUID,
    reason: str | None = None
) -> RegistrationRequest:
    """Reject a registration request."""
    request.status = "rejected"
    request.rejection_reason = reason
    request.processed_at = datetime.utcnow()
    request.processed_by_id = admin_id

    await db.commit()
    await db.refresh(request)
    return request


async def delete_registration_request(
    db: AsyncSession, request: RegistrationRequest
) -> None:
    """Delete a registration request."""
    await db.delete(request)
    await db.commit()
