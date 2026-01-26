from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
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
from app.crud import email_confirmation as token_crud
from app.api.deps import get_current_admin_user
from app.models.user import User
from app.models.email_confirmation import TokenType
from app.services.email import email_service
from app.config import settings

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


class ConfirmEmailResponse(BaseModel):
    message: str
    email: str


@router.get("/confirm/{token}", response_model=ConfirmEmailResponse)
async def confirm_email(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    """Confirm email address and activate user account."""
    confirmation = await token_crud.get_valid_token(db, token)

    if not confirmation:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired confirmation token",
        )

    # Get the user
    user = await user_crud.get_user(db, confirmation.user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    if user.is_active:
        # Already confirmed, just mark token as used
        await token_crud.mark_token_used(db, confirmation)
        return ConfirmEmailResponse(
            message="Email already confirmed",
            email=user.email,
        )

    # Activate the user
    user.is_active = True
    await token_crud.mark_token_used(db, confirmation)
    await db.commit()

    return ConfirmEmailResponse(
        message="Email confirmed successfully. You can now log in.",
        email=user.email,
    )


class ResendConfirmationRequest(BaseModel):
    email: EmailStr


class ResendConfirmationResponse(BaseModel):
    message: str


@router.post("/resend-confirmation", response_model=ResendConfirmationResponse)
async def resend_confirmation(
    request: ResendConfirmationRequest,
    db: AsyncSession = Depends(get_db),
):
    """Resend confirmation email for inactive user."""
    user = await user_crud.get_user_by_email(db, request.email)

    if not user:
        # Don't reveal if user exists or not
        return ResendConfirmationResponse(
            message="If an account with that email exists and is pending confirmation, a new email has been sent."
        )

    if user.is_active:
        return ResendConfirmationResponse(
            message="If an account with that email exists and is pending confirmation, a new email has been sent."
        )

    # Delete old tokens and create a new one
    await token_crud.delete_user_tokens(db, user.id, TokenType.ADMIN_SETUP)
    await token_crud.delete_user_tokens(db, user.id, TokenType.EMAIL_VERIFICATION)

    new_token = await token_crud.create_confirmation_token(
        db, user.id, TokenType.EMAIL_VERIFICATION
    )

    # Try to send email, or print URL
    sent = await email_service.send_email_confirmation(
        user.email,
        user.full_name,
        new_token.token,
        settings.EMAIL_CONFIRMATION_TOKEN_EXPIRE_HOURS,
    )

    if not sent:
        confirmation_url = email_service.get_confirmation_url(new_token.token)
        print(f"\n{'='*60}")
        print(f"CONFIRMATION EMAIL (SMTP not configured)")
        print(f"To: {user.email}")
        print(f"Confirmation URL: {confirmation_url}")
        print(f"{'='*60}\n")

    return ResendConfirmationResponse(
        message="If an account with that email exists and is pending confirmation, a new email has been sent."
    )
