"""Tests for upload_workspace temp-dir routing and orphan sweeper."""

from __future__ import annotations

import uuid
from pathlib import Path

from app.services import upload_workspace


def test_processing_dir_is_under_work_root(tmp_path, monkeypatch):
    monkeypatch.setattr(upload_workspace.settings, "UPLOAD_DIR", str(tmp_path))
    job_id = uuid.uuid4()
    d = upload_workspace.processing_dir(job_id)
    assert d.exists()
    assert d.parent == tmp_path / "work" / "processing"
    assert d.name == str(job_id)


def test_bundle_dir_is_under_work_root(tmp_path, monkeypatch):
    monkeypatch.setattr(upload_workspace.settings, "UPLOAD_DIR", str(tmp_path))
    bundle_id = uuid.uuid4()
    d = upload_workspace.bundle_dir(bundle_id)
    assert d.exists()
    assert d.parent == tmp_path / "work" / "bundles"


def test_inspect_dir_uses_random_token(tmp_path, monkeypatch):
    monkeypatch.setattr(upload_workspace.settings, "UPLOAD_DIR", str(tmp_path))
    a = upload_workspace.inspect_dir()
    b = upload_workspace.inspect_dir()
    assert a != b
    assert a.parent == tmp_path / "work" / "inspect"


def test_sweep_orphans_clears_processing_and_bundles(tmp_path, monkeypatch):
    monkeypatch.setattr(upload_workspace.settings, "UPLOAD_DIR", str(tmp_path))

    # Pre-seed two orphans.
    job1 = upload_workspace.processing_dir(uuid.uuid4())
    bundle1 = upload_workspace.bundle_dir(uuid.uuid4())
    (job1 / "leftover.txt").write_text("x")
    (bundle1 / "leftover.zip").write_bytes(b"y")

    # Inspect dirs should NOT be swept (they're short-lived and the endpoint
    # cleans them up itself; surviving inspect dirs are rare and harmless).
    inspect_d = upload_workspace.inspect_dir()
    (inspect_d / "leftover").write_text("z")

    removed = upload_workspace.sweep_orphans()
    assert removed >= 2
    assert not job1.exists()
    assert not bundle1.exists()
    assert inspect_d.exists()


def test_sweep_orphans_is_idempotent(tmp_path, monkeypatch):
    monkeypatch.setattr(upload_workspace.settings, "UPLOAD_DIR", str(tmp_path))
    # Nothing to sweep — must not raise.
    assert upload_workspace.sweep_orphans() == 0


def test_paths_handle_missing_root(tmp_path, monkeypatch):
    """work_root() must auto-create the parent directory tree."""
    nonexistent = tmp_path / "does" / "not" / "yet"
    monkeypatch.setattr(upload_workspace.settings, "UPLOAD_DIR", str(nonexistent))
    root = upload_workspace.work_root()
    assert root.exists()
    assert root == nonexistent / "work"


def test_processing_dir_is_idempotent(tmp_path, monkeypatch):
    monkeypatch.setattr(upload_workspace.settings, "UPLOAD_DIR", str(tmp_path))
    job_id = uuid.uuid4()
    d1 = upload_workspace.processing_dir(job_id)
    d2 = upload_workspace.processing_dir(job_id)
    assert d1 == d2
    assert d1.exists()


def test_inspect_dir_with_explicit_token(tmp_path, monkeypatch):
    monkeypatch.setattr(upload_workspace.settings, "UPLOAD_DIR", str(tmp_path))
    token = "abc-123"
    d = upload_workspace.inspect_dir(token)
    assert d.name == token


def test_processing_dir_returns_path_type(tmp_path, monkeypatch):
    monkeypatch.setattr(upload_workspace.settings, "UPLOAD_DIR", str(tmp_path))
    d = upload_workspace.processing_dir(uuid.uuid4())
    assert isinstance(d, Path)
