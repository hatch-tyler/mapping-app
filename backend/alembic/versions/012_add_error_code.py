"""Add error_code to upload_jobs for typed failure responses

Revision ID: 012_error_code
Revises: 011_client_nonce
Create Date: 2026-04-29

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "012_error_code"
down_revision: Union[str, None] = "011_client_nonce"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "upload_jobs",
        sa.Column("error_code", sa.String(length=64), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("upload_jobs", "error_code")
