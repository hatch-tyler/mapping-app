"""Optional Azure Blob Storage replication for backups.

When the application is configured with an Azure Storage account,
``backup_service.run_backup`` replicates each freshly written backup
artifact (db / uploads / rasters) into a private blob container after
the local files land. ``prune_old_backups`` deletes the matching blobs
when the corresponding local files age out.

Replication is **best-effort**: a transport-level failure is recorded
on the backup record (``remote_replicated=False`` plus an error
message) but never fails the local backup itself. The local copy is
already on the persistent managed data disk; the blob copy is the
defense against losing that disk.

Authentication is selected at startup based on which env vars are set:

* ``AZURE_STORAGE_CONNECTION_STRING`` wins when present — simplest for
  manual or non-Azure deployments where a key is acceptable.
* Otherwise, ``AZURE_STORAGE_ACCOUNT_URL`` is paired with
  ``DefaultAzureCredential``. On an Azure VM with system-assigned
  managed identity granted ``Storage Blob Data Contributor``, this
  works with no secrets in the environment. Locally,
  ``DefaultAzureCredential`` falls back to the user's ``az login``
  session.

If neither is configured, ``BlobBackupClient.from_settings()`` returns
``None`` and replication is silently skipped.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from app.config import settings

if TYPE_CHECKING:
    from azure.storage.blob import ContainerClient

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class BlobBackupConfig:
    container_name: str
    connection_string: str | None
    account_url: str | None


def _resolve_config() -> BlobBackupConfig | None:
    container = settings.AZURE_BACKUP_CONTAINER.strip()
    if not container:
        return None
    conn = settings.AZURE_STORAGE_CONNECTION_STRING.strip() or None
    url = settings.AZURE_STORAGE_ACCOUNT_URL.strip() or None
    if not conn and not url:
        return None
    return BlobBackupConfig(
        container_name=container,
        connection_string=conn,
        account_url=url,
    )


class BlobBackupClient:
    """Sync wrapper around the Azure Blob Storage SDK.

    All methods are synchronous because the underlying ``azure-storage-blob``
    SDK is synchronous. Async callers in ``backup_service`` wrap calls with
    ``asyncio.to_thread`` to avoid blocking the event loop.
    """

    def __init__(self, container_client: "ContainerClient") -> None:
        self._container = container_client

    @classmethod
    def from_settings(cls) -> "BlobBackupClient | None":
        """Build a client from settings, or return None if not configured.

        Importing the SDK lazily lets a backend that doesn't replicate
        avoid the import-time cost (and makes this module importable in
        environments where the SDK isn't installed).
        """
        cfg = _resolve_config()
        if cfg is None:
            return None

        from azure.storage.blob import BlobServiceClient

        if cfg.connection_string:
            svc = BlobServiceClient.from_connection_string(cfg.connection_string)
        else:
            from azure.identity import DefaultAzureCredential

            svc = BlobServiceClient(
                account_url=cfg.account_url,
                credential=DefaultAzureCredential(),
            )

        container = svc.get_container_client(cfg.container_name)
        # Best-effort container creation. If the credential is missing
        # the right permission or the container already exists, ignore
        # the error and let upload/delete surface real failures.
        try:
            container.create_container()
        except Exception as e:  # pragma: no cover - depends on SDK error type
            logger.debug(
                "Skipping container create for %s (likely already exists): %s",
                cfg.container_name,
                e,
            )

        return cls(container)

    def upload(self, local_path: Path, blob_name: str) -> None:
        """Upload one file, overwriting any existing blob of that name."""
        with local_path.open("rb") as f:
            self._container.upload_blob(name=blob_name, data=f, overwrite=True)

    def delete(self, blob_name: str) -> None:
        """Delete one blob. Missing blobs are not an error (idempotent)."""
        try:
            self._container.delete_blob(blob_name)
        except Exception as e:
            # A 404 means the blob is already gone — pruning is supposed
            # to be idempotent. Log at info; let other transport errors
            # bubble up so the caller can record them.
            from azure.core.exceptions import ResourceNotFoundError

            if isinstance(e, ResourceNotFoundError):
                logger.info("Blob %s already deleted", blob_name)
                return
            raise


def blob_names_for_timestamp(timestamp: str) -> list[str]:
    """Blob names that correspond to one local backup timestamp.

    Mirrors ``backup_service._backup_paths`` 1-to-1; the blob name is
    just the local filename (the container is dedicated to backups so
    a flat namespace is fine).
    """
    return [
        f"db_{timestamp}.sql.gz",
        f"uploads_{timestamp}.tar.gz",
        f"rasters_{timestamp}.tar.gz",
    ]
