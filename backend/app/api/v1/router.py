from fastapi import APIRouter

from app.api.v1 import auth, users, datasets, upload, wfs, export, registration, tiles, projects, external_sources

api_router = APIRouter()

api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(datasets.router)
api_router.include_router(upload.router)
api_router.include_router(wfs.router)
api_router.include_router(export.router)
api_router.include_router(registration.router)
api_router.include_router(tiles.router)
api_router.include_router(projects.router)
api_router.include_router(external_sources.router)
