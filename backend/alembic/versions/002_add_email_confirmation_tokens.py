"""Add email_confirmation_tokens table

Revision ID: 002_email_tokens
Revises: 001_registration
Create Date: 2026-01-22

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '002_email_tokens'
down_revision: Union[str, None] = '001_registration'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create token_type enum
    token_type_enum = postgresql.ENUM(
        'admin_setup', 'email_verification', 'password_reset',
        name='tokentype',
        create_type=False
    )
    token_type_enum.create(op.get_bind(), checkfirst=True)

    op.create_table(
        'email_confirmation_tokens',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('token', sa.String(length=255), nullable=False),
        sa.Column(
            'token_type',
            postgresql.ENUM('admin_setup', 'email_verification', 'password_reset', name='tokentype', create_type=False),
            nullable=False,
            server_default='email_verification'
        ),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_email_confirmation_tokens_token'), 'email_confirmation_tokens', ['token'], unique=True)
    op.create_index(op.f('ix_email_confirmation_tokens_user_id'), 'email_confirmation_tokens', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_email_confirmation_tokens_user_id'), table_name='email_confirmation_tokens')
    op.drop_index(op.f('ix_email_confirmation_tokens_token'), table_name='email_confirmation_tokens')
    op.drop_table('email_confirmation_tokens')

    # Drop enum type
    token_type_enum = postgresql.ENUM('admin_setup', 'email_verification', 'password_reset', name='tokentype')
    token_type_enum.drop(op.get_bind(), checkfirst=True)
