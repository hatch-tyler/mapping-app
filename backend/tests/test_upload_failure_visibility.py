"""Tests that a failed upload job survives the orphan-dataset cleanup.

The frontend polls ``GET /upload/status/{job_id}`` to learn whether a small
upload succeeded or failed. Before this fix the ``UploadJob.dataset_id`` FK
was ``ON DELETE CASCADE``: when the failure-cleanup path in
``process_vector_background`` deleted an orphaned dataset (no table created
yet), the job row went with it. The poll then 404'd, and the polling loop
mistook that for a transient network error — the user saw "Lost connection
to server" 60 s later instead of the real failure reason.

The fix is to switch the FK to ``ON DELETE SET NULL`` so the failure record
survives. These tests pin that behaviour:

1. Deleting a dataset preserves its job row, sets ``dataset_id = NULL``.
2. ``GET /upload/status/{job_id}`` returns 200 with the recorded
   ``error_code`` / ``error_message`` after the dataset row is gone.
3. The bundle-status endpoint LEFT-JOINs so jobs whose dataset was cleaned
   up still show up (with ``dataset_name = "(deleted)"``).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud import dataset as dataset_crud
from app.models.dataset import Dataset, UploadJob
from app.models.user import User
from app.services.upload_errors import UploadErrorCode


@pytest.fixture(autouse=True)
def _enable_sqlite_fks_for_module():
    """Force FK enforcement on the shared SQLite test engine.

    SQLite's ``PRAGMA foreign_keys`` is connection-scoped and must be set
    outside an active transaction; setting it inside one is silently
    ignored. The conftest's PRAGMA event listener races the StaticPool's
    eager-connect, so on this module we register a more aggressive
    listener that runs on every checkout. This is purely test-only
    plumbing — production runs PostgreSQL, which enforces FKs by default.
    """
    from sqlalchemy import event
    import tests.conftest as _conftest  # type: ignore[import-not-found]

    engine = _conftest.test_engine.sync_engine

    def _on_connect(dbapi_conn, _record):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()

    event.listen(engine, "connect", _on_connect)
    # Force PRAGMA on any already-pooled connection by recycling the pool
    # exactly once per test (cheap with StaticPool; just ensures the
    # listener fires at least once on the active connection).
    engine.pool.dispose()
    yield
    event.remove(engine, "connect", _on_connect)


async def _create_orphan_failed_job(
    db: AsyncSession,
    user: User,
    *,
    error_code: UploadErrorCode = UploadErrorCode.MISSING_CRS,
    error_message: str = "No coordinate reference system (CRS) found.",
    bundle_id: uuid.UUID | None = None,
    client_nonce: str | None = None,
) -> UploadJob:
    """Reproduce the production failure-cleanup sequence:

    1. Create a dataset row (as the upload endpoint does).
    2. Create an upload-job row pointing at it.
    3. Mark the job ``failed`` with a typed code (the processor's first
       step in its ``except`` block).
    4. Delete the dataset row (the orphan-cleanup, last step).

    Returns the job after dataset deletion. Without the FK change, this
    helper would raise (the job row would be cascade-deleted).
    """
    dataset = Dataset(
        id=uuid.uuid4(),
        name="failing-upload",
        data_type="vector",
        source_format="zip",
        srid=4326,
        is_visible=True,
        style_config={},
        created_by_id=user.id,
    )
    db.add(dataset)
    await db.commit()
    await db.refresh(dataset)

    job = UploadJob(
        id=uuid.uuid4(),
        dataset_id=dataset.id,
        bundle_id=bundle_id,
        client_nonce=client_nonce,
        status="failed",
        progress=5,
        error_message=error_message,
        error_code=error_code.value,
        completed_at=datetime.now(timezone.utc),
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    # Drop the orphan dataset (table_name was never set, so the failure
    # cleanup decides it's safe to remove).
    await dataset_crud.delete_dataset(db, dataset)

    # Reload the job. The session's identity map would otherwise hand back
    # the cached ORM instance whose in-memory ``dataset_id`` wasn't touched
    # by the FK's ON DELETE SET NULL action (the DB does that out-of-band).
    # ``refresh`` re-fetches the row.
    await db.refresh(job)
    return job


class TestFailedJobSurvivesDatasetCleanup:
    """Pin the FK behaviour: SET NULL, not CASCADE."""

    @pytest.mark.asyncio
    async def test_delete_dataset_preserves_job_with_null_dataset_id(
        self, db_session: AsyncSession, admin_user: User
    ):
        job = await _create_orphan_failed_job(db_session, admin_user)

        assert job is not None, "upload job was deleted with the dataset"
        assert job.dataset_id is None, "FK should have been cleared, not cascaded"
        assert job.status == "failed"
        assert job.error_code == UploadErrorCode.MISSING_CRS.value
        assert job.error_message and "CRS" in job.error_message

    @pytest.mark.asyncio
    async def test_delete_dataset_for_in_progress_job(
        self, db_session: AsyncSession, admin_user: User
    ):
        """Even if the cleanup races the failure-marking step, the job row
        survives — its status is whatever it had when the dataset went away."""
        dataset = Dataset(
            id=uuid.uuid4(),
            name="racing-upload",
            data_type="vector",
            source_format="zip",
            srid=4326,
            is_visible=True,
            style_config={},
            created_by_id=admin_user.id,
        )
        db_session.add(dataset)
        await db_session.commit()
        await db_session.refresh(dataset)

        job = UploadJob(
            id=uuid.uuid4(),
            dataset_id=dataset.id,
            status="processing",
            progress=15,
        )
        db_session.add(job)
        await db_session.commit()

        await dataset_crud.delete_dataset(db_session, dataset)

        # Re-fetch via the ORM with refresh to bypass the identity map's
        # stale cached attributes (the FK's ON DELETE SET NULL fires at
        # the DB level, not in SQLAlchemy's session state).
        await db_session.refresh(job)
        assert job.dataset_id is None, "FK should have set dataset_id to NULL"
        assert job.status == "processing"


class TestUploadStatusEndpointAfterCleanup:
    """The polling endpoint surfaces the real failure rather than 404-ing."""

    @pytest.mark.asyncio
    async def test_status_endpoint_returns_failed_with_null_dataset_id(
        self,
        client: AsyncClient,
        admin_user: User,
        db_session: AsyncSession,
        admin_auth_headers: dict,
    ):
        job = await _create_orphan_failed_job(db_session, admin_user)

        resp = await client.get(
            f"/api/v1/upload/status/{job.id}",
            headers=admin_auth_headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["id"] == str(job.id)
        assert body["dataset_id"] is None
        assert body["status"] == "failed"
        assert body["error_code"] == UploadErrorCode.MISSING_CRS.value
        assert "CRS" in body["error_message"]

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "code,message",
        [
            (UploadErrorCode.EMPTY_FILE, "File contains no features"),
            (
                UploadErrorCode.INVALID_SHAPEFILE_BUNDLE,
                "Shapefile ZIP is missing required files: .shx, .dbf",
            ),
            (
                UploadErrorCode.GDB_LAYER_UNREADABLE,
                "Could not read GDB layer 'parcels': driver error",
            ),
        ],
    )
    async def test_other_fast_failure_modes(
        self,
        code: UploadErrorCode,
        message: str,
        client: AsyncClient,
        admin_user: User,
        db_session: AsyncSession,
        admin_auth_headers: dict,
    ):
        job = await _create_orphan_failed_job(
            db_session, admin_user, error_code=code, error_message=message
        )

        resp = await client.get(
            f"/api/v1/upload/status/{job.id}",
            headers=admin_auth_headers,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["error_code"] == code.value
        assert body["error_message"] == message
        assert body["dataset_id"] is None


class TestBundleStatusLeftJoinsDeletedDatasets:
    """Bundle endpoints LEFT JOIN so cleaned-up jobs still surface."""

    @pytest.mark.asyncio
    async def test_bundle_includes_orphaned_jobs_with_deleted_marker(
        self,
        client: AsyncClient,
        admin_user: User,
        db_session: AsyncSession,
        admin_auth_headers: dict,
    ):
        bundle_id = uuid.uuid4()
        # One live (successful) dataset + one orphaned (failed-and-cleaned-up).
        live_dataset = Dataset(
            id=uuid.uuid4(),
            name="live-dataset",
            data_type="vector",
            source_format="shp",
            srid=4326,
            is_visible=True,
            style_config={},
            created_by_id=admin_user.id,
        )
        db_session.add(live_dataset)
        await db_session.commit()
        await db_session.refresh(live_dataset)

        live_job = UploadJob(
            id=uuid.uuid4(),
            dataset_id=live_dataset.id,
            bundle_id=bundle_id,
            status="completed",
            progress=100,
            completed_at=datetime.now(timezone.utc),
        )
        db_session.add(live_job)
        await db_session.commit()

        orphan_job = await _create_orphan_failed_job(
            db_session, admin_user, bundle_id=bundle_id
        )

        resp = await client.get(
            f"/api/v1/upload/bundles/{bundle_id}",
            headers=admin_auth_headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["bundle_id"] == str(bundle_id)
        jobs_by_id = {j["id"]: j for j in body["jobs"]}
        assert str(live_job.id) in jobs_by_id
        assert str(orphan_job.id) in jobs_by_id

        live = jobs_by_id[str(live_job.id)]
        orphan = jobs_by_id[str(orphan_job.id)]

        assert live["dataset_name"] == "live-dataset"
        assert live["status"] == "completed"
        assert orphan["dataset_id"] is None
        assert orphan["dataset_name"] == "(deleted)"
        assert orphan["status"] == "failed"
        assert orphan["error_code"] == UploadErrorCode.MISSING_CRS.value

    @pytest.mark.asyncio
    async def test_recovery_by_nonce_includes_orphan_job(
        self,
        client: AsyncClient,
        admin_user: User,
        db_session: AsyncSession,
        admin_auth_headers: dict,
    ):
        nonce = "nonce-" + uuid.uuid4().hex
        bundle_id = uuid.uuid4()

        # The owner-check requires at least one live dataset in the bundle
        # owned by the caller. Add a token live row alongside the orphan.
        live_dataset = Dataset(
            id=uuid.uuid4(),
            name="anchor",
            data_type="vector",
            source_format="shp",
            srid=4326,
            is_visible=True,
            style_config={},
            created_by_id=admin_user.id,
        )
        db_session.add(live_dataset)
        await db_session.commit()
        await db_session.refresh(live_dataset)
        db_session.add(
            UploadJob(
                id=uuid.uuid4(),
                dataset_id=live_dataset.id,
                bundle_id=bundle_id,
                client_nonce=nonce,
                status="processing",
                progress=20,
            )
        )
        await db_session.commit()

        await _create_orphan_failed_job(
            db_session, admin_user, bundle_id=bundle_id, client_nonce=nonce
        )

        resp = await client.get(
            f"/api/v1/upload/bundles/by-nonce/{nonce}",
            headers=admin_auth_headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["bundle_id"] == str(bundle_id)
        # Both jobs surface — the orphan with dataset_name "(deleted)".
        names = {j["dataset_name"] for j in body["jobs"]}
        assert names == {"anchor", "(deleted)"}
