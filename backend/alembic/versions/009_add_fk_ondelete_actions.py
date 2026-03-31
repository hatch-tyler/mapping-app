"""Add ondelete SET NULL to created_by_id foreign keys and composite index

Revision ID: 009_fk_ondelete
Revises: 008_template_source
Create Date: 2026-03-31

"""

from typing import Sequence, Union

from alembic import op

revision: str = "009_fk_ondelete"
down_revision: Union[str, None] = "008_template_source"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # datasets.created_by_id
    op.drop_constraint(
        "datasets_created_by_id_fkey", "datasets", type_="foreignkey"
    )
    op.create_foreign_key(
        "datasets_created_by_id_fkey",
        "datasets",
        "users",
        ["created_by_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # projects.created_by_id
    op.drop_constraint(
        "projects_created_by_id_fkey", "projects", type_="foreignkey"
    )
    op.create_foreign_key(
        "projects_created_by_id_fkey",
        "projects",
        "users",
        ["created_by_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # service_catalogs.created_by_id
    op.drop_constraint(
        "service_catalogs_created_by_id_fkey",
        "service_catalogs",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "service_catalogs_created_by_id_fkey",
        "service_catalogs",
        "users",
        ["created_by_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # Composite index for the most common dataset listing query
    op.create_index(
        "ix_datasets_listing",
        "datasets",
        ["is_visible", "source_type", "category", "created_at"],
    )
    # Index on created_by_id for user-scoped queries
    op.create_index(
        "ix_datasets_created_by_id",
        "datasets",
        ["created_by_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_datasets_created_by_id", table_name="datasets")
    op.drop_index("ix_datasets_listing", table_name="datasets")

    # Revert to FK without ondelete
    for table, constraint in [
        ("datasets", "datasets_created_by_id_fkey"),
        ("projects", "projects_created_by_id_fkey"),
        ("service_catalogs", "service_catalogs_created_by_id_fkey"),
    ]:
        op.drop_constraint(constraint, table, type_="foreignkey")
        op.create_foreign_key(
            constraint, table, "users", ["created_by_id"], ["id"]
        )
