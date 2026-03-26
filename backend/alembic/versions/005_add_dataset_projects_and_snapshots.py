"""Add dataset_projects junction table, file_hash, and snapshot columns

Revision ID: 005_dataset_projects
Revises: 004_service_catalogs
Create Date: 2026-03-26

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision: str = "005_dataset_projects"
down_revision: Union[str, None] = "004_service_catalogs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create dataset_projects junction table for many-to-many linking (if not exists)
    op.execute("""
        CREATE TABLE IF NOT EXISTS dataset_projects (
            dataset_id UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
            project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            PRIMARY KEY (dataset_id, project_id)
        )
    """)

    # Add file_hash for duplicate detection (if not exists)
    op.execute("ALTER TABLE datasets ADD COLUMN IF NOT EXISTS file_hash VARCHAR(64)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_datasets_file_hash ON datasets (file_hash)")

    # Add snapshot columns for data versioning (if not exists)
    op.execute("ALTER TABLE datasets ADD COLUMN IF NOT EXISTS snapshot_source_id UUID REFERENCES datasets(id) ON DELETE SET NULL")
    op.execute("ALTER TABLE datasets ADD COLUMN IF NOT EXISTS snapshot_date TIMESTAMP WITH TIME ZONE")
    op.execute("CREATE INDEX IF NOT EXISTS ix_datasets_snapshot_source_id ON datasets (snapshot_source_id)")

    # Auto-populate dataset_projects from existing project_id relationships
    op.execute("""
        INSERT INTO dataset_projects (dataset_id, project_id)
        SELECT id, project_id FROM datasets WHERE project_id IS NOT NULL
        ON CONFLICT DO NOTHING
    """)


def downgrade() -> None:
    op.drop_index("ix_datasets_snapshot_source_id", table_name="datasets")
    op.drop_column("datasets", "snapshot_date")
    op.drop_column("datasets", "snapshot_source_id")
    op.drop_index("ix_datasets_file_hash", table_name="datasets")
    op.drop_column("datasets", "file_hash")
    op.drop_table("dataset_projects")
