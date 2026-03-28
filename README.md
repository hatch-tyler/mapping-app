# Web GIS Application

A production-grade Web GIS platform for unifying geospatial data across an organization. Built for both technical GIS users and non-technical viewers who need quick access to spatial data without desktop GIS software.

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite + deck.gl + MapLibre GL
- **Backend**: FastAPI + SQLAlchemy (async) + GeoAlchemy2
- **Database**: PostgreSQL 16 + PostGIS 3.4
- **Auth**: JWT with access/refresh tokens, role-based access control
- **State Management**: Zustand
- **Deployment**: Docker + nginx + Let's Encrypt SSL on Azure VM

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Node.js 20+ (for local frontend development)
- Python 3.11+ (for local backend development)

### Running with Docker

```bash
cp .env.example .env
docker-compose up -d
```

- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:8000
- **API Docs**: http://localhost:8000/api/docs
- **Default login**: admin@example.com / admin123

## Features

### Map Viewer
- **Interactive map** with deck.gl rendering on MapLibre basemaps
- **9 basemaps**: CARTO (Positron, Dark Matter, Voyager) + Esri (Satellite, Streets, Topographic, Light Gray, National Geographic, Ocean)
- **Feature identification**: Click any feature to inspect all attributes in a slide-out panel
- **Layer manager**: Toggle layers, zoom to extent, view metadata, search/filter datasets
- **Shareable map state**: Zoom, center, and visible layers encoded in URL hash for bookmarking and sharing
- **Zoom-level notifications**: Automatic min_zoom for large datasets with informational banners
- **Clustering**: Point datasets auto-cluster at low zoom levels via Supercluster

### Data Management (Manage Page)
- **Upload local data**: Drag-and-drop file upload with progress tracking
- **Connect external services**: Register ArcGIS Feature/Map/Image Servers, WMS, WFS, XYZ tile services
- **Background imports**: Import external vector services to local PostGIS with adaptive pagination and progress polling (survives page navigation)
- **Dataset organization**: Categorize as reference or project data, assign geographic scope, tag datasets
- **Project management**: Create projects, assign datasets, manage team members with roles
- **Inline editing**: Edit dataset name, description, category, tags, and zoom range
- **Visibility and sharing**: Toggle dataset visibility and public access
- **Style editor**: Uniform, categorical, and graduated color modes with color ramps
- **Metadata refresh**: Re-probe all external service metadata with one click
- **Toast notifications**: In-app notification system for all actions

### External Service Support
- **ArcGIS FeatureServer**: Vector data with adaptive page size fetching, per-field unique values for styling
- **ArcGIS MapServer**: Cached image tiles rendered directly (no proxy overhead)
- **ArcGIS ImageServer**: Dynamic image export rendered directly
- **WMS**: GetMap tile rendering via proxy
- **WFS**: GetFeature with pagination
- **XYZ/TMS**: Direct tile rendering
- **Service catalog**: Save and organize frequently used service endpoints

### Supported Upload Formats
- **Vector**: GeoJSON, Shapefile (ZIP), GeoPackage
- **Raster**: GeoTIFF, JPEG2000 (.jp2), Erdas Imagine (.img), ASCII Grid (.asc), Esri BIL/BIP/BSQ (.bil/.bip/.bsq/.flt), ZIP archives for multi-file formats

### Data Serving (for ArcGIS Pro / QGIS)
- **ArcGIS REST API**: `/arcgis/{dataset}/FeatureServer/0/query` — compatible with ArcGIS Pro (maxRecordCount=50,000)
- **OGC WFS**: `/api/v1/wfs` — GetCapabilities, GetFeature, DescribeFeatureType
- **Vector tiles (MVT)**: `/api/v1/datasets/{id}/tiles/{z}/{x}/{y}.pbf` — auto-enabled for datasets with 10,000+ features
- **GeoJSON export**: `/api/v1/datasets/{id}/geojson` — up to 50,000 features
- **File export**: GeoPackage, Shapefile (ZIP), KML

### User & Role Management (Admin Page)
- **Three roles**: Admin, Editor, Viewer
- **Admin**: Full system access — user management, registration approvals, all data operations
- **Editor**: Upload data, manage own datasets, create projects, toggle visibility/public, import external services
- **Viewer**: Read-only map access, browse catalog, view data
- **Auto-provisioning**: New users start as Viewer; admins promote as needed
- **User management**: Change roles, activate/deactivate accounts, delete users

### Data Discovery
- **Catalog page**: Browse all datasets with filtering by category, type, source, geographic scope, project, and tags
- **Metadata modal**: View dataset details, service info, field definitions, bounds
- **Data browser**: Feature table with sorting, filtering, pagination, column visibility, and export

## Project Structure

```
mapping-app/
├── backend/                    # FastAPI backend
│   ├── app/
│   │   ├── api/v1/             # REST endpoints
│   │   ├── api/arcgis/         # ArcGIS REST API compatibility
│   │   ├── core/               # Security, config
│   │   ├── crud/               # Database operations
│   │   ├── models/             # SQLAlchemy + GeoAlchemy2 models
│   │   ├── schemas/            # Pydantic validation
│   │   └── services/           # Business logic (file processing, external sources, import)
│   ├── alembic/                # Database migrations
│   └── Dockerfile.prod         # Production image (multi-stage, GDAL)
├── frontend/                   # React frontend
│   ├── src/
│   │   ├── api/                # Axios API client modules
│   │   ├── components/
│   │   │   ├── admin/          # Data management components
│   │   │   ├── auth/           # Protected routes
│   │   │   ├── catalog/        # Data discovery
│   │   │   ├── common/         # Toast notifications, error boundary
│   │   │   ├── data/           # Feature table, export
│   │   │   ├── layout/         # Navbar
│   │   │   ├── map/            # Map container, layer manager, basemap gallery, feature panel
│   │   │   └── styling/        # Style editor panels
│   │   ├── pages/              # Route pages
│   │   ├── stores/             # Zustand (auth, dataset, map, toast, import)
│   │   └── utils/              # Layer factory, style interpreter, color ramps
│   └── Dockerfile              # Dev + production nginx targets
├── azure/                      # Infrastructure
│   ├── docker-compose.prod.yml
│   ├── nginx/                  # Nginx config with SSL
│   ├── terraform/              # Azure VM provisioning
│   └── scripts/                # Deployment scripts
└── docker-compose.yml          # Local development
```

## Development

### Backend

```bash
cd backend
pip install -e ".[dev]"
uvicorn app.main:app --reload    # http://localhost:8000
pytest                           # Run tests
black . && ruff check .          # Format and lint
```

### Frontend

```bash
cd frontend
npm install
npm run dev                      # http://localhost:5173
npm run test:run                 # Run tests
npm run lint                     # Lint
```

### Database Migrations

```bash
cd backend
alembic upgrade head                              # Apply all
alembic revision --autogenerate -m "description"  # Generate new
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | (required) |
| `SECRET_KEY` | JWT signing key | (required) |
| `CORS_ORIGINS` | Allowed CORS origins | `*` |
| `VITE_API_URL` | Backend API URL (frontend build) | `http://localhost:8000` |
| `INITIAL_ADMIN_EMAIL` | Bootstrap admin email | (optional) |
| `INITIAL_ADMIN_PASSWORD` | Bootstrap admin password | (optional) |

## Architecture

### Layer Rendering Strategy

| Dataset Size | Renderer | Details |
|-------------|----------|---------|
| Local, < 10K features | GeoJsonLayer | Direct GeoJSON, all features in browser |
| Local, >= 10K features | MVTLayer | Server-side vector tiles via PostGIS ST_AsMVT |
| External FeatureServer | TileLayer | Per-tile queries with adaptive feature limits |
| External MapServer | TileLayer + BitmapLayer | Direct cached tile access (no proxy) |
| External ImageServer | TileLayer + BitmapLayer | Direct image export (no proxy) |
| External WMS | TileLayer + BitmapLayer | GetMap via backend proxy |
| External XYZ/TMS | TileLayer + BitmapLayer | Direct tile access |
| Local raster | TileLayer + BitmapLayer | Served as raster tiles |

### Database Connection Pool

Configured for up to 100 concurrent users: `pool_size=10, max_overflow=20` (30 total connections across 4 Gunicorn workers).

### Background Tasks

External dataset imports run as `asyncio.create_task()` background tasks with short-lived database sessions to avoid blocking the connection pool during long network fetches. Progress tracked via UploadJob records, polled by the frontend every 2 seconds.
