from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.registration import (
    RegistrationRequestCreate,
    RegistrationRequestResponse,
    RegistrationRequestListResponse,
    RejectRequest,
    RegistrationSubmitResponse,
)
from app.crud import registration as registration_crud
from app.crud import user as user_crud
from app.api.deps import get_current_admin_user
from app.models.user import User
from app.services.email import email_service

router = APIRouter(prefix="/registration", tags=["registration"])


@router.post("/request", response_model=RegistrationSubmitResponse)
async def submit_registration_request(
    request_in: RegistrationRequestCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Submit a public registration request (no auth required)."""
    # Check if email already exists as a user
    existing_user = await user_crud.get_user_by_email(db, request_in.email)
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered",
        )

    # Check if there's already a pending request for this email
    existing_request = await registration_crud.get_registration_by_email(
        db, request_in.email
    )
    if existing_request:
        if existing_request.status == "pending":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A registration request for this email is already pending",
            )
        elif existing_request.status == "rejected":
            # Delete old rejected request so they can try again
            await registration_crud.delete_registration_request(db, existing_request)

    # Create the registration request
    registration = await registration_crud.create_registration_request(db, request_in)

    # Send notification email to admin in the background
    background_tasks.add_task(
        email_service.send_admin_new_registration,
        registration.email,
        registration.full_name,
    )

    return RegistrationSubmitResponse(
        message="Registration request submitted successfully. An administrator will review your request.",
        email=registration.email,
    )


@router.get("/requests", response_model=RegistrationRequestListResponse)
async def list_registration_requests(
    skip: int = 0,
    limit: int = 100,
    pending_only: bool = True,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """List registration requests (admin only)."""
    if pending_only:
        requests, total = await registration_crud.get_pending_requests(db, skip, limit)
    else:
        requests, total = await registration_crud.get_all_requests(db, skip, limit)

    return RegistrationRequestListResponse(requests=requests, total=total)


@router.get("/requests/{request_id}", response_model=RegistrationRequestResponse)
async def get_registration_request(
    request_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """Get a specific registration request (admin only)."""
    request = await registration_crud.get_registration_request(db, request_id)
    if not request:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Registration request not found",
        )
    return request


@router.post("/requests/{request_id}/approve", response_model=RegistrationRequestResponse)
async def approve_registration_request(
    request_id: UUID,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """Approve a registration request (admin only)."""
    request = await registration_crud.get_registration_request(db, request_id)
    if not request:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Registration request not found",
        )

    if request.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot approve a request with status '{request.status}'",
        )

    # Check again that the email isn't already registered
    existing_user = await user_crud.get_user_by_email(db, request.email)
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A user with this email already exists",
        )

    # Approve the request (creates the user)
    await registration_crud.approve_request(db, request, current_user.id)

    # Send approval email in the background
    background_tasks.add_task(
        email_service.send_registration_approved,
        request.email,
        request.full_name,
    )

    # Refresh the request to get updated status
    await db.refresh(request)
    return request


@router.post("/requests/{request_id}/reject", response_model=RegistrationRequestResponse)
async def reject_registration_request(
    request_id: UUID,
    reject_data: RejectRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """Reject a registration request (admin only)."""
    request = await registration_crud.get_registration_request(db, request_id)
    if not request:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Registration request not found",
        )

    if request.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot reject a request with status '{request.status}'",
        )

    # Reject the request
    request = await registration_crud.reject_request(
        db, request, current_user.id, reject_data.reason
    )

    # Send rejection email in the background
    background_tasks.add_task(
        email_service.send_registration_rejected,
        request.email,
        request.full_name,
        reject_data.reason,
    )

    return request
