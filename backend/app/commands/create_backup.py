"""Standalone entry point for the scheduled cron.

Invoked by the host cron via:
    docker exec gis-backend python -m app.commands.create_backup

Exit code 0 on success (including a "0 backups pruned" run), non-zero on
any backup failure so cron logs surface it. The script also prunes
backups older than ``settings.BACKUP_RETENTION_DAYS`` after a successful
run.
"""

from __future__ import annotations

import asyncio
import logging
import sys

from app.config import settings
from app.services.backup_service import (
    BackupInProgressError,
    prune_old_backups,
    run_backup,
)


async def _main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    logger = logging.getLogger("create_backup")

    try:
        result = await run_backup(source="scheduled")
    except BackupInProgressError as e:
        # Another backup is already running (e.g. a manual one started just
        # before the cron fired). Treat as success — the other run will
        # produce the artifacts.
        logger.warning("Skipping scheduled backup: %s", e)
        return 0
    except Exception as e:  # pragma: no cover - defensive
        logger.exception("Unexpected error running scheduled backup")
        print(f"backup failed: {e}", file=sys.stderr)
        return 1

    if result.status != "completed":
        logger.error(
            "Scheduled backup %s ended with status=%s error=%s",
            result.timestamp,
            result.status,
            result.error_message,
        )
        return 1

    logger.info(
        "Scheduled backup %s completed (%d bytes)",
        result.timestamp,
        result.total_size_bytes,
    )

    try:
        pruned = await prune_old_backups(retention_days=settings.BACKUP_RETENTION_DAYS)
    except Exception:
        logger.exception("Backup completed but prune step failed")
        return 1

    if pruned:
        logger.info(
            "Pruned %d backup(s) older than %d days",
            pruned,
            settings.BACKUP_RETENTION_DAYS,
        )
    return 0


def main() -> int:
    return asyncio.run(_main())


if __name__ == "__main__":
    sys.exit(main())
