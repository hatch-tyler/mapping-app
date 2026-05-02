"""Tests for app.services.blob_backup.

These tests do not hit Azure. They exercise:
* Configuration resolution (which env-var combos enable replication).
* The factory's lazy SDK import path with a fake BlobServiceClient.
* delete()'s idempotent treatment of missing blobs.
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from app.services import blob_backup
from app.services.blob_backup import (
    BlobBackupClient,
    blob_names_for_timestamp,
)


@pytest.fixture
def reset_settings(monkeypatch):
    """Force every blob-related setting to empty before each test so the
    factory starts from a clean slate."""
    monkeypatch.setattr(blob_backup.settings, "AZURE_BACKUP_CONTAINER", "")
    monkeypatch.setattr(blob_backup.settings, "AZURE_STORAGE_CONNECTION_STRING", "")
    monkeypatch.setattr(blob_backup.settings, "AZURE_STORAGE_ACCOUNT_URL", "")


def test_from_settings_returns_none_when_unconfigured(reset_settings):
    assert BlobBackupClient.from_settings() is None


def test_from_settings_returns_none_when_only_container_set(reset_settings, monkeypatch):
    """A container alone is not enough — auth must also be configured."""
    monkeypatch.setattr(blob_backup.settings, "AZURE_BACKUP_CONTAINER", "backups")
    assert BlobBackupClient.from_settings() is None


def test_from_settings_uses_connection_string_when_present(reset_settings, monkeypatch):
    """Connection string wins over account URL — simplest path for self-hosted."""
    monkeypatch.setattr(blob_backup.settings, "AZURE_BACKUP_CONTAINER", "backups")
    monkeypatch.setattr(
        blob_backup.settings,
        "AZURE_STORAGE_CONNECTION_STRING",
        "DefaultEndpointsProtocol=https;AccountName=fake;AccountKey=Zm9v",
    )
    monkeypatch.setattr(
        blob_backup.settings,
        "AZURE_STORAGE_ACCOUNT_URL",
        "https://other.blob.core.windows.net",
    )

    fake_svc = MagicMock()
    fake_svc.get_container_client.return_value = MagicMock()
    fake_module = MagicMock()
    fake_module.BlobServiceClient.from_connection_string.return_value = fake_svc

    monkeypatch.setitem(sys.modules, "azure.storage.blob", fake_module)

    client = BlobBackupClient.from_settings()
    assert client is not None
    fake_module.BlobServiceClient.from_connection_string.assert_called_once_with(
        "DefaultEndpointsProtocol=https;AccountName=fake;AccountKey=Zm9v"
    )
    fake_svc.get_container_client.assert_called_once_with("backups")


def test_from_settings_uses_default_credential_when_url_only(
    reset_settings, monkeypatch
):
    """No connection string → fall back to DefaultAzureCredential, which
    picks up the VM's managed identity in production."""
    monkeypatch.setattr(blob_backup.settings, "AZURE_BACKUP_CONTAINER", "backups")
    monkeypatch.setattr(
        blob_backup.settings,
        "AZURE_STORAGE_ACCOUNT_URL",
        "https://acct.blob.core.windows.net",
    )

    fake_svc = MagicMock()
    fake_svc.get_container_client.return_value = MagicMock()
    fake_blob_module = MagicMock()
    fake_blob_module.BlobServiceClient.return_value = fake_svc
    fake_identity_module = MagicMock()
    sentinel_credential = object()
    fake_identity_module.DefaultAzureCredential.return_value = sentinel_credential

    monkeypatch.setitem(sys.modules, "azure.storage.blob", fake_blob_module)
    monkeypatch.setitem(sys.modules, "azure.identity", fake_identity_module)

    client = BlobBackupClient.from_settings()
    assert client is not None
    fake_blob_module.BlobServiceClient.assert_called_once_with(
        account_url="https://acct.blob.core.windows.net",
        credential=sentinel_credential,
    )


def test_upload_streams_file_with_overwrite(tmp_path):
    """upload() opens the file and hands it to upload_blob with overwrite=True
    so re-running a backup with the same timestamp replaces stale data."""
    container = MagicMock()
    client = BlobBackupClient(container)
    f = tmp_path / "db_20260101_000000.sql.gz"
    f.write_bytes(b"\x1f\x8b binary")

    client.upload(f, "db_20260101_000000.sql.gz")

    container.upload_blob.assert_called_once()
    kwargs = container.upload_blob.call_args.kwargs
    assert kwargs["name"] == "db_20260101_000000.sql.gz"
    assert kwargs["overwrite"] is True


def test_delete_swallows_resource_not_found(monkeypatch):
    """A missing blob is not an error — pruning is idempotent."""
    # Build a fake ResourceNotFoundError class and inject the module so
    # blob_backup.delete() can catch it without importing real azure.
    class _ResourceNotFoundError(Exception):
        pass

    fake_exceptions = MagicMock()
    fake_exceptions.ResourceNotFoundError = _ResourceNotFoundError
    monkeypatch.setitem(sys.modules, "azure.core.exceptions", fake_exceptions)

    container = MagicMock()
    container.delete_blob.side_effect = _ResourceNotFoundError("gone")
    client = BlobBackupClient(container)

    # Must NOT raise.
    client.delete("db_xxx.sql.gz")


def test_delete_propagates_other_errors(monkeypatch):
    """Non-404 transport errors must surface so callers can record them."""

    class _ResourceNotFoundError(Exception):
        pass

    fake_exceptions = MagicMock()
    fake_exceptions.ResourceNotFoundError = _ResourceNotFoundError
    monkeypatch.setitem(sys.modules, "azure.core.exceptions", fake_exceptions)

    container = MagicMock()
    container.delete_blob.side_effect = RuntimeError("auth failed")
    client = BlobBackupClient(container)

    with pytest.raises(RuntimeError, match="auth failed"):
        client.delete("db_xxx.sql.gz")


def test_blob_names_for_timestamp_matches_local_filenames():
    """Blob names mirror local filenames — keep the two in lockstep so
    prune-deletes-blobs works without a separate manifest."""
    names = blob_names_for_timestamp("20260502_020002")
    assert names == [
        "db_20260502_020002.sql.gz",
        "uploads_20260502_020002.tar.gz",
        "rasters_20260502_020002.tar.gz",
    ]
