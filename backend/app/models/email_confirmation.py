import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, ForeignKey, func, Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
import enum

from app.database import Base


class TokenType(str, enum.Enum):
    ADMIN_SETUP = "admin_setup"
    EMAIL_VERIFICATION = "email_verification"
    PASSWORD_RESET = "password_reset"


class EmailConfirmationToken(Base):
    __tablename__ = "email_confirmation_tokens"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    token_type: Mapped[TokenType] = mapped_column(
        SQLEnum(TokenType), nullable=False, default=TokenType.EMAIL_VERIFICATION
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    user: Mapped["User"] = relationship("User")


# Import to avoid circular imports
from app.models.user import User  # noqa: E402, F401
