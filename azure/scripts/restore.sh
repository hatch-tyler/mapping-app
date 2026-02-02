#!/bin/bash
set -euo pipefail

# Restore script for mapping application
# Usage: ./restore.sh <backup_timestamp>
# Example: ./restore.sh 20250115_020000

APP_DIR="/opt/mapping-app"
BACKUP_DIR="/mnt/data/backups"
COMPOSE_FILE="$APP_DIR/docker-compose.prod.yml"

if [ $# -lt 1 ]; then
    echo "Usage: $0 <backup_timestamp>"
    echo ""
    echo "Available backups:"
    ls -1 "$BACKUP_DIR"/db_*.sql.gz 2>/dev/null | sed 's/.*db_/  /' | sed 's/\.sql\.gz//' || echo "  (none found)"
    exit 1
fi

TIMESTAMP="$1"
DB_BACKUP="$BACKUP_DIR/db_${TIMESTAMP}.sql.gz"
UPLOADS_BACKUP="$BACKUP_DIR/uploads_${TIMESTAMP}.tar.gz"
RASTERS_BACKUP="$BACKUP_DIR/rasters_${TIMESTAMP}.tar.gz"

# Verify database backup exists
if [ ! -f "$DB_BACKUP" ]; then
    echo "ERROR: Database backup not found: $DB_BACKUP"
    exit 1
fi

# Source env for DB credentials
set -a
source "$APP_DIR/.env"
set +a

echo "=== Restore from backup: $TIMESTAMP ==="
echo ""
echo "Files:"
echo "  Database: $DB_BACKUP ($(du -h "$DB_BACKUP" | cut -f1))"
[ -f "$UPLOADS_BACKUP" ] && echo "  Uploads:  $UPLOADS_BACKUP ($(du -h "$UPLOADS_BACKUP" | cut -f1))" || echo "  Uploads:  (not found, skipping)"
[ -f "$RASTERS_BACKUP" ] && echo "  Rasters:  $RASTERS_BACKUP ($(du -h "$RASTERS_BACKUP" | cut -f1))" || echo "  Rasters:  (not found, skipping)"
echo ""

read -p "This will OVERWRITE the current database and uploads. Continue? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Restore cancelled."
    exit 0
fi

# Stop backend to prevent writes during restore
echo ""
echo "--- Stopping backend ---"
docker compose -f "$COMPOSE_FILE" stop backend

# Restore database
echo "--- Restoring database ---"
gunzip -c "$DB_BACKUP" | docker compose -f "$COMPOSE_FILE" exec -T db \
    psql -U "${DB_USER:-gis_user}" -d "${DB_NAME:-gis_db}" --single-transaction --quiet

if [ $? -eq 0 ]; then
    echo "  Database restored successfully"
else
    echo "  WARNING: Database restore had errors (this may be normal for extension-related warnings)"
fi

# Restore uploads
if [ -f "$UPLOADS_BACKUP" ]; then
    echo "--- Restoring uploads ---"
    rm -rf /mnt/data/uploads/*
    tar -xzf "$UPLOADS_BACKUP" -C /mnt/data/
    echo "  Uploads restored successfully"
fi

# Restore rasters
if [ -f "$RASTERS_BACKUP" ]; then
    echo "--- Restoring rasters ---"
    rm -rf /mnt/data/rasters/*
    tar -xzf "$RASTERS_BACKUP" -C /mnt/data/
    echo "  Rasters restored successfully"
fi

# Restart backend
echo "--- Starting backend ---"
docker compose -f "$COMPOSE_FILE" start backend

# Wait for health check
echo "--- Waiting for health check ---"
MAX_RETRIES=30
RETRY_COUNT=0
until curl -sf http://localhost/api/health > /dev/null 2>&1; do
    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
        echo "WARNING: Backend health check failed after $MAX_RETRIES attempts"
        echo "Check logs: docker compose -f $COMPOSE_FILE logs backend"
        break
    fi
    sleep 5
done

if [ $RETRY_COUNT -lt $MAX_RETRIES ]; then
    echo "  Health check passed"
fi

echo ""
echo "=== Restore complete ==="
