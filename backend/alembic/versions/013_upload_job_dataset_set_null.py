"""Switch upload_jobs.dataset_id FK to ON DELETE SET NULL

Lets a failed upload job survive when its orphan dataset row is cleaned up
by the background processor. Previously the CASCADE took the job row out
with the dataset, which made fast-failing uploads (missing CRS, empty
file, invalid shapefile bundle) appear to the frontend as "lost connection
to server" — every poll after the cleanup hit a 404 and the polling loop
treated it as a transient network error.

Revision ID: 013_upload_job_set_null
Revises: 012_error_code
Create Date: 2026-05-01

"""

from typing import Sequence, Union

from alembic import op

revision: str = "013_upload_job_set_null"
down_revision: Union[str, None] = "012_error_code"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# The constraint name SQLAlchemy/Postgres assigned when the table was first
# created. ``alembic upgrade`` won't have changed it.
_FK_NAME = "upload_jobs_dataset_id_fkey"


def upgrade() -> None:
    op.drop_constraint(_FK_NAME, "upload_jobs", type_="foreignkey")
    op.alter_column("upload_jobs", "dataset_id", nullable=True)
    op.create_foreign_key(
        _FK_NAME,
        "upload_jobs",
        "datasets",
        ["dataset_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    # Note: rows with dataset_id IS NULL would block the NOT NULL restore, so
    # delete them first. They are failed, fully-cleaned-up upload jobs and
    # carry no live data.
    op.execute("DELETE FROM upload_jobs WHERE dataset_id IS NULL")
    op.drop_constraint(_FK_NAME, "upload_jobs", type_="foreignkey")
    op.alter_column("upload_jobs", "dataset_id", nullable=False)
    op.create_foreign_key(
        _FK_NAME,
        "upload_jobs",
        "datasets",
        ["dataset_id"],
        ["id"],
        ondelete="CASCADE",
    )
