# Web GIS Application

A production-grade web GIS application built with React, deck.gl, FastAPI, and PostGIS.

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite + deck.gl + MapLibre GL
- **Backend**: FastAPI + SQLAlchemy + GeoAlchemy2
- **Database**: PostgreSQL 16 + PostGIS 3.4
- **Auth**: JWT-based authentication
- **State Management**: Zustand

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Node.js 20+ (for local frontend development)
- Python 3.11+ (for local backend development)

### Running with Docker

1. Copy the environment file:
   ```bash
   cp .env.example .env
   ```

2. Start all services:
   ```bash
   docker-compose up -d
   ```

3. Access the application:
   - Frontend: http://localhost:5173
   - Backend API: http://localhost:8000
   - API Docs: http://localhost:8000/api/docs

### Default Credentials

- Email: `admin@example.com`
- Password: `admin123`

## Project Structure

```
mapping-app/
├── backend/           # FastAPI backend
│   ├── app/
│   │   ├── api/       # API endpoints
│   │   ├── core/      # Security, config
│   │   ├── crud/      # Database operations
│   │   ├── models/    # SQLAlchemy models
│   │   ├── schemas/   # Pydantic schemas
│   │   └── services/  # Business logic
│   └── Dockerfile
├── frontend/          # React frontend
│   ├── src/
│   │   ├── api/       # API client
│   │   ├── components/
│   │   ├── pages/
│   │   ├── stores/    # Zustand stores
│   │   └── utils/
│   └── Dockerfile
├── data/              # Uploaded files
└── docker-compose.yml
```

## Features

- **Interactive Map**: deck.gl layers with MapLibre base maps
- **Vector Data Support**: GeoJSON, Shapefile (ZIP), GeoPackage
- **Raster Data Support**: GeoTIFF
- **Admin Dashboard**:
  - Tabular view of all datasets
  - Toggle dataset visibility on/off
  - File upload with drag-and-drop
  - Delete datasets
- **JWT Authentication**: Access and refresh tokens

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/auth/login` | POST | Login and get tokens |
| `/api/v1/auth/refresh` | POST | Refresh access token |
| `/api/v1/datasets/` | GET | List all datasets |
| `/api/v1/datasets/{id}` | GET | Get dataset details |
| `/api/v1/datasets/{id}/visibility` | PATCH | Toggle visibility |
| `/api/v1/datasets/{id}/geojson` | GET | Get GeoJSON data |
| `/api/v1/upload/vector` | POST | Upload vector file |
| `/api/v1/upload/raster` | POST | Upload raster file |

## Development

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate  # or venv\Scripts\activate on Windows
pip install -e ".[dev]"
uvicorn app.main:app --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | - |
| `SECRET_KEY` | JWT signing key | - |
| `CORS_ORIGINS` | Allowed CORS origins | - |
| `VITE_API_URL` | Backend API URL | http://localhost:8000 |
