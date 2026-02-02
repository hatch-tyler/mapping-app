#!/bin/bash
set -euo pipefail

# Deploy script for mapping application
# Usage: ./deploy.sh [--skip-pull] [--skip-build]

APP_DIR="/opt/mapping-app"
COMPOSE_FILE="$APP_DIR/docker-compose.prod.yml"

SKIP_PULL=false
SKIP_BUILD=false

for arg in "$@"; do
    case $arg in
        --skip-pull)  SKIP_PULL=true ;;
        --skip-build) SKIP_BUILD=true ;;
        *)            echo "Unknown argument: $arg"; exit 1 ;;
    esac
done

cd "$APP_DIR"

echo "=== Deployment started at $(date) ==="

# Pull latest code
if [ "$SKIP_PULL" = false ] && [ -d "$APP_DIR/repo/.git" ]; then
    echo "--- Pulling latest code ---"
    cd "$APP_DIR/repo"
    git pull
    cd "$APP_DIR"

    # Copy updated compose file and scripts from repo
    cp "$APP_DIR/repo/azure/docker-compose.prod.yml" "$APP_DIR/docker-compose.prod.yml"
    cp "$APP_DIR/repo/azure/scripts/"*.sh "$APP_DIR/scripts/" 2>/dev/null || true
    chmod +x "$APP_DIR/scripts/"*.sh 2>/dev/null || true
else
    echo "--- Skipping git pull ---"
fi

# Rebuild frontend
if [ "$SKIP_BUILD" = false ]; then
    echo "--- Building frontend ---"
    docker compose -f "$COMPOSE_FILE" --profile build build frontend-builder
    docker compose -f "$COMPOSE_FILE" --profile build run --rm frontend-builder
fi

# Rebuild backend
echo "--- Building backend ---"
docker compose -f "$COMPOSE_FILE" build backend

# Rolling restart: bring up new containers
echo "--- Restarting services ---"
docker compose -f "$COMPOSE_FILE" up -d --remove-orphans

# Wait for backend health check
echo "--- Waiting for backend health check ---"
MAX_RETRIES=30
RETRY_COUNT=0
until curl -sf http://localhost/api/health > /dev/null 2>&1; do
    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
        echo "ERROR: Backend health check failed after $MAX_RETRIES attempts"
        echo "--- Recent logs ---"
        docker compose -f "$COMPOSE_FILE" logs --tail=50 backend
        exit 1
    fi
    echo "  Waiting for backend... ($RETRY_COUNT/$MAX_RETRIES)"
    sleep 5
done

echo "--- Health check passed ---"

# Clean up old Docker images
echo "--- Cleaning up old images ---"
docker image prune -f

echo "=== Deployment completed at $(date) ==="
echo ""
echo "Services status:"
docker compose -f "$COMPOSE_FILE" ps
