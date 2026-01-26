import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.email_confirmation import EmailConfirmationToken, TokenType
from app.config import settings


def generate_secure_token() -> str:
    """Generate a cryptographically secure token."""
    return secrets.token_urlsafe(32)


async def create_confirmation_token(
    db: AsyncSession,
    user_id: UUID,
    token_type: TokenType = TokenType.EMAIL_VERIFICATION,
    expire_hours: int | None = None,
) -> EmailConfirmationToken:
    """Create a new email confirmation token for a user."""
    if expire_hours is None:
        expire_hours = settings.EMAIL_CONFIRMATION_TOKEN_EXPIRE_HOURS

    token = generate_secure_token()
    expires_at = datetime.now(timezone.utc) + timedelta(hours=expire_hours)

    confirmation_token = EmailConfirmationToken(
        user_id=user_id,
        token=token,
        token_type=token_type,
        expires_at=expires_at,
    )
    db.add(confirmation_token)
    await db.commit()
    await db.refresh(confirmation_token)
    return confirmation_token


async def get_valid_token(
    db: AsyncSession,
    token: str,
    token_type: TokenType | None = None,
) -> EmailConfirmationToken | None:
    """Get a valid (unexpired, unused) token."""
    query = select(EmailConfirmationToken).where(
        EmailConfirmationToken.token == token,
        EmailConfirmationToken.used_at.is_(None),
        EmailConfirmationToken.expires_at > datetime.now(timezone.utc),
    )
    if token_type:
        query = query.where(EmailConfirmationToken.token_type == token_type)

    result = await db.execute(query)
    return result.scalar_one_or_none()


async def mark_token_used(db: AsyncSession, token: EmailConfirmationToken) -> None:
    """Mark a token as used."""
    token.used_at = datetime.now(timezone.utc)
    await db.commit()


async def delete_user_tokens(
    db: AsyncSession,
    user_id: UUID,
    token_type: TokenType | None = None,
) -> int:
    """Delete all tokens for a user, optionally filtered by type."""
    query = delete(EmailConfirmationToken).where(
        EmailConfirmationToken.user_id == user_id
    )
    if token_type:
        query = query.where(EmailConfirmationToken.token_type == token_type)

    result = await db.execute(query)
    await db.commit()
    return result.rowcount


async def get_pending_token_for_user(
    db: AsyncSession,
    user_id: UUID,
    token_type: TokenType,
) -> EmailConfirmationToken | None:
    """Get a pending (unused, unexpired) token for a user."""
    result = await db.execute(
        select(EmailConfirmationToken).where(
            EmailConfirmationToken.user_id == user_id,
            EmailConfirmationToken.token_type == token_type,
            EmailConfirmationToken.used_at.is_(None),
            EmailConfirmationToken.expires_at > datetime.now(timezone.utc),
        )
    )
    return result.scalar_one_or_none()
