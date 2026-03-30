"""Add dataset organization: projects, tags, categories, external source fields

Revision ID: 003_dataset_org
Revises: 002_email_tokens
Create Date: 2026-03-24

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "003_dataset_org"
down_revision: Union[str, None] = "002_email_tokens"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create projects table
    op.create_table(
        "projects",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("is_active", sa.Boolean, server_default="true", nullable=False),
        sa.Column(
            "created_by_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )

    # Create project_members table
    op.create_table(
        "project_members",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("role", sa.String(50), server_default="viewer", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("project_id", "user_id", name="uq_project_member"),
    )

    # Create tags table
    op.create_table(
        "tags",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(100), unique=True, nullable=False, index=True),
    )

    # Create dataset_tags association table
    op.create_table(
        "dataset_tags",
        sa.Column(
            "dataset_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("datasets.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "tag_id",
            sa.Integer,
            sa.ForeignKey("tags.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )

    # Add new columns to datasets table
    op.add_column(
        "datasets",
        sa.Column("source_type", sa.String(50), server_default="local", nullable=False),
    )
    op.add_column(
        "datasets",
        sa.Column(
            "category", sa.String(50), server_default="reference", nullable=False
        ),
    )
    op.add_column(
        "datasets", sa.Column("geographic_scope", sa.String(50), nullable=True)
    )
    op.add_column("datasets", sa.Column("service_url", sa.String(1000), nullable=True))
    op.add_column("datasets", sa.Column("service_type", sa.String(50), nullable=True))
    op.add_column(
        "datasets", sa.Column("service_layer_id", sa.String(255), nullable=True)
    )
    op.add_column(
        "datasets", sa.Column("service_metadata", postgresql.JSONB, nullable=True)
    )
    op.add_column(
        "datasets",
        sa.Column("last_service_check", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "datasets",
        sa.Column(
            "project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("projects.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "datasets",
        sa.Column("is_privileged", sa.Boolean, server_default="false", nullable=False),
    )

    # Add indexes
    op.create_index("ix_datasets_source_type", "datasets", ["source_type"])
    op.create_index("ix_datasets_category", "datasets", ["category"])
    op.create_index("ix_datasets_geographic_scope", "datasets", ["geographic_scope"])
    op.create_index("ix_datasets_project_id", "datasets", ["project_id"])


def downgrade() -> None:
    # Drop indexes
    op.drop_index("ix_datasets_project_id", "datasets")
    op.drop_index("ix_datasets_geographic_scope", "datasets")
    op.drop_index("ix_datasets_category", "datasets")
    op.drop_index("ix_datasets_source_type", "datasets")

    # Drop columns from datasets
    op.drop_column("datasets", "is_privileged")
    op.drop_column("datasets", "project_id")
    op.drop_column("datasets", "last_service_check")
    op.drop_column("datasets", "service_metadata")
    op.drop_column("datasets", "service_layer_id")
    op.drop_column("datasets", "service_type")
    op.drop_column("datasets", "service_url")
    op.drop_column("datasets", "geographic_scope")
    op.drop_column("datasets", "category")
    op.drop_column("datasets", "source_type")

    # Drop tables in reverse order
    op.drop_table("dataset_tags")
    op.drop_table("tags")
    op.drop_table("project_members")
    op.drop_table("projects")
