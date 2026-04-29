"""Add client_nonce to upload_jobs for exact-match bundle recovery

Revision ID: 011_client_nonce
Revises: 010_bundle_id
Create Date: 2026-04-29

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "011_client_nonce"
down_revision: Union[str, None] = "010_bundle_id"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "upload_jobs",
        sa.Column("client_nonce", sa.String(length=64), nullable=True),
    )
    op.create_index(
        "ix_upload_jobs_client_nonce",
        "upload_jobs",
        ["client_nonce"],
    )


def downgrade() -> None:
    op.drop_index("ix_upload_jobs_client_nonce", table_name="upload_jobs")
    op.drop_column("upload_jobs", "client_nonce")
