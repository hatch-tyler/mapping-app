# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A production-grade Web GIS application for geospatial data visualization and management. Built with React + TypeScript frontend and FastAPI + PostgreSQL/PostGIS backend.

## Development Commands

### Frontend (from `frontend/`)
```bash
npm install              # Install dependencies
npm run dev              # Start Vite dev server (port 5173)
npm run build            # TypeScript compile + Vite build
npm run lint             # ESLint for TS/TSX files
npm run test             # Vitest watch mode
npm run test:run         # Vitest single run
npm run test:coverage    # Vitest with coverage
```

### Backend (from `backend/`)
```bash
pip install -e ".[dev]"              # Install with dev dependencies
uvicorn app.main:app --reload        # Start FastAPI dev server (port 8000)
pytest                               # Run all tests
pytest -v                            # Verbose test output
pytest --cov                         # Tests with coverage
black .                              # Format code
ruff check .                         # Lint code
mypy .                               # Type checking
```

### Docker (full stack)
```bash
cp .env.example .env
docker-compose up -d
```
- Frontend: http://localhost:5173
- Backend API: http://localhost:8000
- API Docs: http://localhost:8000/api/docs
- Default login: admin@example.com / admin123

## Architecture

### Backend Structure (`backend/app/`)
- **api/v1/**: REST endpoints (auth, datasets, upload, wfs, export, registration)
- **api/arcgis/**: ArcGIS REST API compatibility layer
- **core/**: Security and authentication (JWT with access/refresh tokens)
- **crud/**: Database CRUD operations
- **models/**: SQLAlchemy ORM models with GeoAlchemy2 for spatial types
- **schemas/**: Pydantic request/response validation
- **services/**: Business logic (arcgis, email)

### Frontend Structure (`frontend/src/`)
- **api/**: Axios-based API client modules
- **components/**: React components (admin/, auth/, map/, common/)
- **pages/**: Route page components (LoginPage, RegisterPage, MapPage, AdminPage)
- **stores/**: Zustand state stores (authStore, datasetStore, mapStore)
- **hooks/**: Custom React hooks

### Data Flow
1. FastAPI receives requests at `/api/v1/*` endpoints
2. Pydantic validates input, CRUD layer handles database operations
3. SQLAlchemy + GeoAlchemy2 manages PostGIS spatial data
4. Frontend uses Zustand for state, React Query for server state
5. Deck.gl renders geospatial layers on MapLibre basemaps

### Database
- PostgreSQL 16 + PostGIS 3.4
- Migrations via Alembic (`backend/alembic/`)
- Key models: Users, Datasets (with geometry), RefreshTokens, RegistrationRequests, UploadJobs

### Supported Data Formats
- Vector: GeoJSON, Shapefile (ZIP), GeoPackage
- Raster: GeoTIFF

## Code Style

### Backend
- Python 3.11+, async-first with SQLAlchemy asyncio
- Line length: 88 (Black/Ruff)
- pytest with `asyncio_mode=auto`

### Frontend
- TypeScript strict mode
- React 18 with hooks
- Tailwind CSS for styling
- 95% coverage thresholds in Vitest
