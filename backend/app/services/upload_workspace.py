"""Centralized temp-directory management for the upload pipeline.

Before this module existed, three call sites under ``app.api.v1.upload`` and
``app.services.file_processor`` each computed their own temp paths:

* ``<UPLOAD_DIR>/processing/<job_id>``
* ``<UPLOAD_DIR>/inspect/<uuid>``
* ``<UPLOAD_DIR>/bundles/<bundle_id>``

…plus the ad-hoc ``_lpk_extracted`` directory under a job dir. The lifespan
startup hook only swept ``processing/``, leaving orphaned ``bundles/`` dirs
behind after a crash. This module routes every upload-related temp dir under
a single root, ``<UPLOAD_DIR>/work/<kind>/<id>``, so the sweeper has one
place to clean.

Public surface:

* :func:`work_root` — the single sweepable root.
* :func:`processing_dir`, :func:`inspect_dir`, :func:`bundle_dir` —
  returns the managed path for each kind. The directory is created.
* :func:`sweep_orphans` — remove ``processing/`` and ``bundles/`` subtrees
  whose owning job/bundle is no longer pending. Call from lifespan startup.
"""

from __future__ import annotations

import logging
import shutil
import uuid
from pathlib import Path
from typing import Iterable

from app.config import settings

logger = logging.getLogger(__name__)


def work_root() -> Path:
    """Return the single root for all upload temp dirs.

    Created if it doesn't exist yet.
    """
    root = Path(settings.UPLOAD_DIR) / "work"
    root.mkdir(parents=True, exist_ok=True)
    return root


def processing_dir(job_id: uuid.UUID) -> Path:
    """Persistent per-job processing dir for single-file vector/raster uploads.

    Cleaned up by the bg processor's ``finally`` block on success or failure;
    survivors are swept by :func:`sweep_orphans` on next lifespan startup.
    """
    d = work_root() / "processing" / str(job_id)
    d.mkdir(parents=True, exist_ok=True)
    return d


def inspect_dir(token: str | uuid.UUID | None = None) -> Path:
    """Short-lived dir for /upload/inspect; deleted by the endpoint's finally."""
    d = work_root() / "inspect" / str(token or uuid.uuid4())
    d.mkdir(parents=True, exist_ok=True)
    return d


def bundle_dir(bundle_id: uuid.UUID) -> Path:
    """Persistent dir for a bundle upload's ZIP + per-job extraction subdirs.

    The bundle's outer ZIP is removed by ``_process_bundle_sequentially``
    once all per-dataset jobs finish; per-job subdirs are removed by the
    individual processors. Survivors of crashes are swept on lifespan startup.
    """
    d = work_root() / "bundles" / str(bundle_id)
    d.mkdir(parents=True, exist_ok=True)
    return d


def _orphan_subdirs(parent: Path) -> Iterable[Path]:
    if not parent.exists():
        return ()
    return (p for p in parent.iterdir() if p.is_dir())


def sweep_orphans() -> int:
    """Remove leftover processing/bundle dirs from prior runs.

    Returns the number of subtrees removed. Safe to call repeatedly. Doesn't
    look at the DB; it just clears everything under ``processing/`` and
    ``bundles/`` because those are only populated during in-flight uploads —
    if the worker is starting up, nothing is in-flight by definition.
    """
    removed = 0
    root = work_root()
    for kind in ("processing", "bundles"):
        kind_root = root / kind
        for sub in _orphan_subdirs(kind_root):
            try:
                shutil.rmtree(sub, ignore_errors=True)
                removed += 1
            except OSError as e:
                logger.warning("Failed to remove orphan %s: %s", sub, e)
    if removed:
        logger.info("Swept %d orphaned upload-work subtree(s)", removed)
    return removed
