from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.auth import Token, LoginRequest, RefreshRequest
from app.schemas.user import UserCreate, UserResponse
from app.core.security import (
    verify_password,
    create_access_token,
    create_refresh_token,
    verify_token,
)
from app.crud import user as user_crud
from app.api.deps import get_current_admin_user
from app.models.user import User

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=Token)
async def login(
    login_data: LoginRequest,
    db: AsyncSession = Depends(get_db),
):
    user = await user_crud.get_user_by_email(db, login_data.email)

    if not user or not verify_password(login_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive",
        )

    access_token = create_access_token(subject=str(user.id))
    refresh_token, expires_at = create_refresh_token(subject=str(user.id))

    await user_crud.create_refresh_token(db, user.id, refresh_token, expires_at)

    return Token(access_token=access_token, refresh_token=refresh_token)


@router.post("/register", response_model=UserResponse)
async def register(
    user_in: UserCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    existing_user = await user_crud.get_user_by_email(db, user_in.email)
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered",
        )

    user = await user_crud.create_user(db, user_in)
    return user


@router.post("/refresh", response_model=Token)
async def refresh_token(
    refresh_data: RefreshRequest,
    db: AsyncSession = Depends(get_db),
):
    payload = verify_token(refresh_data.refresh_token, token_type="refresh")

    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
        )

    stored_token = await user_crud.get_refresh_token(db, refresh_data.refresh_token)

    if not stored_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token not found or revoked",
        )

    if stored_token.expires_at < datetime.now(timezone.utc):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token expired",
        )

    # Revoke old refresh token
    await user_crud.revoke_refresh_token(db, refresh_data.refresh_token)

    # Create new tokens
    user_id = payload.get("sub")
    access_token = create_access_token(subject=user_id)
    new_refresh_token, expires_at = create_refresh_token(subject=user_id)

    await user_crud.create_refresh_token(
        db, stored_token.user_id, new_refresh_token, expires_at
    )

    return Token(access_token=access_token, refresh_token=new_refresh_token)


@router.post("/logout")
async def logout(
    refresh_data: RefreshRequest,
    db: AsyncSession = Depends(get_db),
):
    await user_crud.revoke_refresh_token(db, refresh_data.refresh_token)
    return {"message": "Successfully logged out"}
