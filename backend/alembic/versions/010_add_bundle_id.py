"""Add bundle_id to upload_jobs for multi-dataset ZIP uploads

Revision ID: 010_bundle_id
Revises: 009_fk_ondelete
Create Date: 2026-04-14

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "010_bundle_id"
down_revision: Union[str, None] = "009_fk_ondelete"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "upload_jobs",
        sa.Column("bundle_id", sa.Uuid(), nullable=True),
    )
    op.create_index(
        "ix_upload_jobs_bundle_id",
        "upload_jobs",
        ["bundle_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_upload_jobs_bundle_id", table_name="upload_jobs")
    op.drop_column("upload_jobs", "bundle_id")
