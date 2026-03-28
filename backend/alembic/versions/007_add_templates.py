"""Add layout_templates and map_views tables

Revision ID: 007_templates
Revises: 006_user_roles
Create Date: 2026-03-27

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision: str = "007_templates"
down_revision: Union[str, None] = "006_user_roles"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "layout_templates",
        sa.Column("id", UUID(), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("project_id", UUID(), sa.ForeignKey("projects.id", ondelete="SET NULL"), index=True),
        sa.Column("page_config", JSONB(), nullable=False),
        sa.Column("elements", JSONB(), nullable=False),
        sa.Column("logo_path", sa.String(500)),
        sa.Column("created_by_id", UUID(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "map_views",
        sa.Column("id", UUID(), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("project_id", UUID(), sa.ForeignKey("projects.id", ondelete="SET NULL"), index=True),
        sa.Column("map_config", JSONB(), nullable=False),
        sa.Column("layer_configs", JSONB(), nullable=False),
        sa.Column("created_by_id", UUID(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("map_views")
    op.drop_table("layout_templates")
