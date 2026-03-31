"""Add source_file_path and source_format to layout_templates

Revision ID: 008_template_source
Revises: 007_templates
Create Date: 2026-03-30

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "008_template_source"
down_revision: Union[str, None] = "007_templates"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "layout_templates",
        sa.Column("source_file_path", sa.String(500), nullable=True),
    )
    op.add_column(
        "layout_templates",
        sa.Column("source_format", sa.String(10), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("layout_templates", "source_format")
    op.drop_column("layout_templates", "source_file_path")
