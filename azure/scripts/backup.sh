#!/bin/bash
set -euo pipefail

# Backup script for mapping application
# Usage: ./backup.sh [--upload-azure]
# Recommended: run via cron daily
#   0 2 * * * /opt/mapping-app/scripts/backup.sh >> /var/log/mapping-app-backup.log 2>&1

APP_DIR="/opt/mapping-app"
BACKUP_DIR="/mnt/data/backups"
COMPOSE_FILE="$APP_DIR/docker-compose.prod.yml"
RETENTION_DAYS=30
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
UPLOAD_AZURE=false

for arg in "$@"; do
    case $arg in
        --upload-azure) UPLOAD_AZURE=true ;;
        *)              echo "Unknown argument: $arg"; exit 1 ;;
    esac
done

# Source env for DB credentials
set -a
source "$APP_DIR/.env"
set +a

echo "=== Backup started at $(date) ==="

mkdir -p "$BACKUP_DIR"

# Database backup
echo "--- Backing up database ---"
DB_BACKUP_FILE="$BACKUP_DIR/db_${TIMESTAMP}.sql.gz"
docker compose -f "$COMPOSE_FILE" exec -T db \
    pg_dump -U "${DB_USER:-gis_user}" -d "${DB_NAME:-gis_db}" --no-owner --no-acl | \
    gzip > "$DB_BACKUP_FILE"
echo "  Database backup: $DB_BACKUP_FILE ($(du -h "$DB_BACKUP_FILE" | cut -f1))"

# Uploads backup
echo "--- Backing up uploads ---"
UPLOADS_BACKUP_FILE="$BACKUP_DIR/uploads_${TIMESTAMP}.tar.gz"
if [ -d /mnt/data/uploads ] && [ "$(ls -A /mnt/data/uploads 2>/dev/null)" ]; then
    tar -czf "$UPLOADS_BACKUP_FILE" -C /mnt/data uploads/
    echo "  Uploads backup: $UPLOADS_BACKUP_FILE ($(du -h "$UPLOADS_BACKUP_FILE" | cut -f1))"
else
    echo "  No uploads to backup"
fi

# Rasters backup
echo "--- Backing up rasters ---"
RASTERS_BACKUP_FILE="$BACKUP_DIR/rasters_${TIMESTAMP}.tar.gz"
if [ -d /mnt/data/rasters ] && [ "$(ls -A /mnt/data/rasters 2>/dev/null)" ]; then
    tar -czf "$RASTERS_BACKUP_FILE" -C /mnt/data rasters/
    echo "  Rasters backup: $RASTERS_BACKUP_FILE ($(du -h "$RASTERS_BACKUP_FILE" | cut -f1))"
else
    echo "  No rasters to backup"
fi

# Upload to Azure Blob Storage (optional)
if [ "$UPLOAD_AZURE" = true ]; then
    echo "--- Uploading to Azure Blob Storage ---"
    if command -v az &> /dev/null; then
        STORAGE_ACCOUNT="${AZURE_STORAGE_ACCOUNT:-}"
        CONTAINER="${AZURE_BACKUP_CONTAINER:-backups}"

        if [ -n "$STORAGE_ACCOUNT" ]; then
            az storage blob upload --account-name "$STORAGE_ACCOUNT" \
                --container-name "$CONTAINER" \
                --name "db_${TIMESTAMP}.sql.gz" \
                --file "$DB_BACKUP_FILE" \
                --auth-mode login 2>/dev/null && echo "  Uploaded DB backup" || echo "  WARNING: DB backup upload failed"

            if [ -f "$UPLOADS_BACKUP_FILE" ]; then
                az storage blob upload --account-name "$STORAGE_ACCOUNT" \
                    --container-name "$CONTAINER" \
                    --name "uploads_${TIMESTAMP}.tar.gz" \
                    --file "$UPLOADS_BACKUP_FILE" \
                    --auth-mode login 2>/dev/null && echo "  Uploaded uploads backup" || echo "  WARNING: Uploads backup upload failed"
            fi

            if [ -f "$RASTERS_BACKUP_FILE" ]; then
                az storage blob upload --account-name "$STORAGE_ACCOUNT" \
                    --container-name "$CONTAINER" \
                    --name "rasters_${TIMESTAMP}.tar.gz" \
                    --file "$RASTERS_BACKUP_FILE" \
                    --auth-mode login 2>/dev/null && echo "  Uploaded rasters backup" || echo "  WARNING: Rasters backup upload failed"
            fi
        else
            echo "  WARNING: AZURE_STORAGE_ACCOUNT not set, skipping upload"
        fi
    else
        echo "  WARNING: Azure CLI not installed, skipping upload"
    fi
fi

# Clean up old backups
echo "--- Cleaning up backups older than ${RETENTION_DAYS} days ---"
DELETED_COUNT=$(find "$BACKUP_DIR" -name "*.gz" -mtime +${RETENTION_DAYS} -print -delete | wc -l)
echo "  Deleted $DELETED_COUNT old backup files"

echo "=== Backup completed at $(date) ==="

# Summary
echo ""
echo "Current backups:"
ls -lh "$BACKUP_DIR"/*.gz 2>/dev/null || echo "  (none)"
echo ""
echo "Disk usage: $(du -sh "$BACKUP_DIR" | cut -f1)"
