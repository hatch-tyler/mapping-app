# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A production-grade Web GIS application for geospatial data visualization and management. Built with React + TypeScript frontend and FastAPI + PostgreSQL/PostGIS backend. Deployed on Azure VM with Docker Hub images.

## Development Commands

### Frontend (from `frontend/`)
```bash
npm install                              # Install dependencies
npm run dev                              # Start Vite dev server (port 5173)
npm run build                            # TypeScript compile + Vite build
npm run lint                             # ESLint for TS/TSX files
npm run test                             # Vitest watch mode
npm run test:run                         # Vitest single run
npm run test:coverage                    # Vitest with coverage
npx vitest run src/path/to/file.test.ts  # Run a single test file
```

### Backend (from `backend/`)
```bash
pip install -e ".[dev]"              # Install with dev dependencies
uvicorn app.main:app --reload        # Start FastAPI dev server (port 8000)
pytest                               # Run all tests (verbose by default via pytest.ini)
pytest tests/test_file.py            # Run a single test file
pytest tests/test_file.py::test_name # Run a single test function
pytest --cov                         # Tests with coverage
black .                              # Format code
ruff check .                         # Lint code
mypy .                               # Type checking
```

### Database Migrations (from `backend/`)
```bash
alembic upgrade head                 # Apply all migrations
alembic revision --autogenerate -m "description"  # Generate new migration
alembic downgrade -1                 # Rollback last migration
```

### Docker (local dev stack)
```bash
cp .env.example .env
docker-compose up -d
```
- Frontend: http://localhost:5173
- Backend API: http://localhost:8000
- API Docs: http://localhost:8000/api/docs
- Default login: admin@example.com / admin123

## Production Deployment

### Docker Hub Images
- **Backend**: `tjhatch/mapping-app-backend:latest`
- **Frontend**: `tjhatch/mapping-app-frontend:latest`

### Build and Push (from project root)

Build both images locally:
```bash
# Backend (uses Dockerfile.prod, multi-stage with GDAL/GeoPandas)
docker build -t tjhatch/mapping-app-backend:latest -f backend/Dockerfile.prod backend/

# Frontend (production target = nginx serving built assets, VITE_API_URL="" for relative paths)
docker build -t tjhatch/mapping-app-frontend:latest --target production --build-arg VITE_API_URL="" -f frontend/Dockerfile frontend/
```

Push to Docker Hub:
```bash
docker push tjhatch/mapping-app-backend:latest
docker push tjhatch/mapping-app-frontend:latest
```

### Azure VM Deployment

**VM**: `azureuser@172.173.68.247`
**FQDN**: `gis-mapping-app.centralus.cloudapp.azure.com`
**App dir on VM**: `/opt/mapping-app`
**Compose file**: `/opt/mapping-app/docker-compose.prod.yml`

#### Full deployment sequence (run from local machine):
```bash
# 1. SSH and pull new images
ssh azureuser@172.173.68.247 "cd /opt/mapping-app && docker compose -f docker-compose.prod.yml pull backend frontend-builder"

# 2. Copy frontend build into nginx volume
ssh azureuser@172.173.68.247 "cd /opt/mapping-app && docker compose -f docker-compose.prod.yml --profile build run --rm frontend-builder"

# 3. Restart backend (picks up new image, waits for DB health)
ssh azureuser@172.173.68.247 "cd /opt/mapping-app && docker compose -f docker-compose.prod.yml up -d --remove-orphans backend nginx"

# 4. Reload nginx to serve new frontend files
ssh azureuser@172.173.68.247 "docker exec gis-nginx nginx -s reload"

# 5. Health check (wait a few seconds for startup)
ssh azureuser@172.173.68.247 "sleep 5 && curl -sf http://localhost/api/health"

# 6. Verify all services running
ssh azureuser@172.173.68.247 "docker compose -f /opt/mapping-app/docker-compose.prod.yml ps"

# 7. Clean up old images
ssh azureuser@172.173.68.247 "docker image prune -f"
```

#### Troubleshooting on the VM:
```bash
# View backend logs
ssh azureuser@172.173.68.247 "docker logs gis-backend --tail=50"

# View nginx logs
ssh azureuser@172.173.68.247 "docker logs gis-nginx --tail=50"

# Restart a specific service
ssh azureuser@172.173.68.247 "cd /opt/mapping-app && docker compose -f docker-compose.prod.yml restart backend"

# Full service status
ssh azureuser@172.173.68.247 "docker compose -f /opt/mapping-app/docker-compose.prod.yml ps"
```

### Azure Infrastructure (Terraform)

Terraform config is in `azure/terraform/`. State is managed locally (not in repo).

```bash
cd azure/terraform
terraform init
terraform plan
terraform apply
```

Key config: `azure/terraform/terraform.tfvars`

## Architecture

### Backend Structure (`backend/app/`)
- **api/v1/**: REST endpoints (auth, datasets, upload, wfs, export, registration, users, projects, external_sources, tiles)
- **api/arcgis/**: ArcGIS REST API compatibility layer (FeatureServer query endpoint)
- **core/**: Security and authentication (JWT with access/refresh tokens)
- **crud/**: Database CRUD operations
- **models/**: SQLAlchemy ORM models with GeoAlchemy2 for spatial types
- **schemas/**: Pydantic request/response validation
- **services/**: Business logic (file_processor, external_source, import_service, email)

### Frontend Structure (`frontend/src/`)
- **api/**: Axios-based API client modules (auth, datasets, users, projects, externalSources)
- **components/**: React components (admin/, auth/, map/, common/, catalog/, data/, styling/, layout/)
- **pages/**: Route page components (LoginPage, RegisterPage, MapPage, AdminPage, UploadPage/DataManager, DataPage, CatalogPage)
- **stores/**: Zustand state stores (authStore, datasetStore, mapStore, toastStore, importStore)
- **hooks/**: Custom React hooks
- **utils/**: Layer factory, style interpreter, color ramps, cluster layer

### Data Flow
1. FastAPI receives requests at `/api/v1/*` endpoints
2. Pydantic validates input, CRUD layer handles database operations
3. SQLAlchemy + GeoAlchemy2 manages PostGIS spatial data
4. Frontend uses Zustand for state, React Query for server state
5. Deck.gl renders geospatial layers on MapLibre basemaps
6. Style interpreter converts `style_config` JSONB to Deck.gl color accessors

### Production Stack (Azure VM)
- **nginx**: Reverse proxy, serves frontend static files, SSL termination via certbot
- **backend**: Gunicorn + Uvicorn workers (tjhatch/mapping-app-backend)
- **frontend-builder**: One-shot container that copies built frontend into nginx volume
- **db**: PostGIS 16-3.4 with data on `/mnt/data/postgres`
- **certbot**: Auto-renews Let's Encrypt certificates

### Database
- PostgreSQL 16 + PostGIS 3.4
- Migrations via Alembic (`backend/alembic/`)
- Key models: Users (with role: admin/editor/viewer), Datasets (with geometry + style_config JSONB), Projects, ProjectMembers, RefreshTokens, RegistrationRequests, UploadJobs

### Supported Data Formats
- Vector: GeoJSON, Shapefile (ZIP), GeoPackage
- Raster: GeoTIFF, JPEG2000 (.jp2), Erdas Imagine (.img), ASCII Grid (.asc), Esri BIL/BIP/BSQ, Esri Float Grid (.flt)
- External: ArcGIS FeatureServer, ArcGIS MapServer, ArcGIS ImageServer, WMS, WFS, XYZ/TMS

### Layer Rendering Strategy
Choice of Deck.gl layer depends on dataset size and source:

| Dataset Size/Type | Renderer | Details |
|-------------------|----------|---------|
| Local, < 10K features | GeoJsonLayer | Direct GeoJSON, all features in browser |
| Local, >= 10K features | MVTLayer | Server-side vector tiles via PostGIS `ST_AsMVT` |
| External FeatureServer | TileLayer | Per-tile queries with adaptive feature limits |
| External MapServer/ImageServer/XYZ | TileLayer + BitmapLayer | Direct cached tile access (no proxy) |
| External WMS | TileLayer + BitmapLayer | GetMap via backend proxy |
| Local raster | TileLayer + BitmapLayer | Served as raster tiles |

MVT auto-enables for datasets with 10,000+ features.

### Background Tasks and Connection Pool
- External dataset imports run as `asyncio.create_task()` with **short-lived DB sessions** to avoid blocking the pool during long network fetches. Progress is tracked via `UploadJob` rows, polled from the frontend every 2s via `importStore` (survives navigation).
- DB pool sized for ~100 concurrent users: `pool_size=10, max_overflow=20` per worker (× 4 Gunicorn workers = 120 total connections). Be mindful of long-held sessions in new endpoints.

### Layer Styling System
- `style_config` JSONB field stored per dataset in the database
- Three modes: `uniform` (single color), `categorical` (color by field), `graduated` (color ramp)
- Style interpreter (`frontend/src/utils/styleInterpreter.ts`) converts config to Deck.gl accessors
- Color ramps defined in `frontend/src/utils/colorRamps.ts`
- StyleEditor modal accessible from DatasetTable and LayerManager
- Categorical mode supports unique values from both local PostGIS and external ArcGIS services

## Code Style

### Backend
- Python 3.11+, async-first with SQLAlchemy asyncio
- Line length: 88 (Black/Ruff)
- pytest with `asyncio_mode=auto`

### Frontend
- TypeScript strict mode
- React 18 with hooks
- Tailwind CSS for styling
- Path alias: `@` maps to `src/` (use `@/components/...` etc.)
- Coverage thresholds: 95% statements/lines, 90% branches/functions
- Tests use jsdom environment with globals enabled (no need to import `describe`/`it`/`expect`)

## Key Files

| Area | File | Purpose |
|------|------|---------|
| Docker | `backend/Dockerfile.prod` | Production backend image (multi-stage, GDAL) |
| Docker | `frontend/Dockerfile` | Frontend image (dev + production nginx targets) |
| Docker | `azure/docker-compose.prod.yml` | Production compose on Azure VM |
| Docker | `docker-compose.yml` | Local development compose |
| Infra | `azure/terraform/main.tf` | Azure VM infrastructure |
| Deploy | `azure/scripts/deploy.sh` | VM-side deploy script |
| Nginx | `azure/nginx/nginx.conf` | Production nginx with SSL |
| Nginx | `azure/nginx/nginx-initial.conf` | Pre-SSL nginx (initial setup only) |
| Styling | `frontend/src/utils/styleInterpreter.ts` | Style config to Deck.gl accessors |
| Styling | `frontend/src/utils/colorRamps.ts` | Color ramp definitions |
| Layers | `frontend/src/utils/layerFactory.ts` | Creates Deck.gl layers from datasets |
| Layers | `frontend/src/utils/clusterLayer.ts` | Point clustering with Supercluster |
| Import | `backend/app/services/import_service.py` | Background external-to-local import |
| External | `backend/app/services/external_source.py` | Probe, fetch, proxy external services |
| Map | `frontend/src/components/map/FeatureDetailPanel.tsx` | Click-to-inspect feature attributes |
| State | `frontend/src/stores/importStore.ts` | Persistent import polling across navigation |
| State | `frontend/src/stores/toastStore.ts` | In-app toast notification system |
