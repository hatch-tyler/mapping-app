"""Add role column to users table

Revision ID: 006_user_roles
Revises: 005_dataset_projects
Create Date: 2026-03-26

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "006_user_roles"
down_revision: Union[str, None] = "005_dataset_projects"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add role column with default 'viewer'
    op.add_column(
        "users",
        sa.Column("role", sa.String(20), nullable=False, server_default="viewer"),
    )
    op.create_index("ix_users_role", "users", ["role"])

    # Backfill: set role='admin' for existing admin users
    op.execute("UPDATE users SET role = 'admin' WHERE is_admin = TRUE")

    # Update datasets.created_by_id FK to SET NULL on user deletion
    op.drop_constraint("datasets_created_by_id_fkey", "datasets", type_="foreignkey")
    op.create_foreign_key(
        "datasets_created_by_id_fkey",
        "datasets",
        "users",
        ["created_by_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    # Restore original FK without ondelete
    op.drop_constraint("datasets_created_by_id_fkey", "datasets", type_="foreignkey")
    op.create_foreign_key(
        "datasets_created_by_id_fkey",
        "datasets",
        "users",
        ["created_by_id"],
        ["id"],
    )

    op.drop_index("ix_users_role", "users")
    op.drop_column("users", "role")
