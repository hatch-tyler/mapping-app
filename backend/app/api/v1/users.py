import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.user import (
    AdminUserUpdate,
    ChangePasswordRequest,
    UserResponse,
    UserUpdate,
)
from app.crud import user as user_crud
from app.api.deps import get_current_user, get_current_admin_user
from app.core.security import verify_password, get_password_hash
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(
    current_user: User = Depends(get_current_user),
):
    return current_user


@router.put("/me", response_model=UserResponse)
async def update_current_user(
    user_in: UserUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if user_in.email:
        existing = await user_crud.get_user_by_email(db, user_in.email)
        if existing and existing.id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already registered",
            )

    updated_user = await user_crud.update_user(db, current_user, user_in)
    return updated_user


@router.post("/me/change-password")
async def change_password(
    body: ChangePasswordRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not verify_password(body.current_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect",
        )
    current_user.hashed_password = get_password_hash(body.new_password)
    await db.commit()
    return {"message": "Password changed successfully"}


@router.get("/")
async def list_users(
    skip: int = 0,
    limit: int = 100,
    role: str | None = Query(None, description="Filter by role (admin only)"),
    is_active: bool | None = Query(
        None, description="Filter by active status (admin only)"
    ),
    search: str | None = Query(None, description="Search by email or name"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    is_admin = current_user.role == "admin" or current_user.is_admin
    # Non-admins only see active users and cannot filter by role/status
    users = await user_crud.get_users(
        db,
        skip=skip,
        limit=limit,
        role=role if is_admin else None,
        is_active=is_active if is_admin else True,
        search=search,
    )
    if is_admin:
        return users
    # Non-admins get a limited response (id, email, full_name only)
    return [{"id": u.id, "email": u.email, "full_name": u.full_name} for u in users]


@router.get("/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    user = await user_crud.get_user(db, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )
    return user


@router.patch("/{user_id}", response_model=UserResponse)
async def admin_update_user(
    user_id: UUID,
    user_in: AdminUserUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    if user_id == current_user.id and user_in.role is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot change your own role",
        )

    user = await user_crud.get_user(db, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    old_role = user.role
    updated_user = await user_crud.admin_update_user(db, user, user_in)

    if user_in.role is not None and old_role != updated_user.role:
        logger.info(
            "User %s role changed from %s to %s by admin %s",
            user_id,
            old_role,
            updated_user.role,
            current_user.id,
        )

    return updated_user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete your own account",
        )

    user = await user_crud.get_user(db, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    logger.info(
        "User %s (%s) deleted by admin %s", user_id, user.email, current_user.id
    )
    await user_crud.delete_user(db, user)
