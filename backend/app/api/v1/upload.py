import os
import tempfile
import shutil
from uuid import UUID
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.dataset import DatasetCreate, DatasetResponse, UploadJobResponse
from app.crud import dataset as dataset_crud
from app.api.deps import get_current_admin_user
from app.api.v1.datasets import dataset_to_response
from app.models.user import User
from app.services.file_processor import file_processor, FileProcessor
from app.config import settings

router = APIRouter(prefix="/upload", tags=["upload"])

import logging
logger = logging.getLogger(__name__)

@router.post("/vector", response_model=DatasetResponse)
async def upload_vector(
    file: UploadFile = File(...),
    name: str = Form(...),
    description: str = Form(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No filename provided",
        )

    ext = FileProcessor.get_file_extension(file.filename)
    if not FileProcessor.is_vector_file(file.filename):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file format: {ext}. Supported: {FileProcessor.SUPPORTED_VECTOR}",
        )

    # Create dataset record first
    dataset_in = DatasetCreate(name=name, description=description)
    dataset = await dataset_crud.create_dataset(
        db,
        dataset_in,
        data_type="vector",
        source_format=ext.lstrip("."),
        created_by_id=current_user.id,
    )

    # Save uploaded file to temp location
    temp_dir = tempfile.mkdtemp()
    temp_path = Path(temp_dir) / file.filename

    try:
        with open(temp_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        # Process the file
        result = await file_processor.process_vector(temp_path, dataset.id, db)

        # Update dataset with processing results
        dataset.geometry_type = result["geometry_type"]
        dataset.feature_count = result["feature_count"]
        dataset.table_name = result["table_name"]
        # Store bounds as metadata (simplified - in production use actual geometry)

        await db.commit()
        await db.refresh(dataset)

        return dataset_to_response(dataset)

    except Exception as e:
        # Log the full error
        logger.exception(f"Upload failed for file {file.filename}: {str(e)}")
        # Rollback the transaction first
        await db.rollback()
        # Clean up on error - use a new transaction
        try:
            await dataset_crud.delete_dataset(db, dataset)
        except Exception:
            pass  # Ignore cleanup errors
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process file: {str(e)}",
        )
    finally:
        # Clean up temp files
        shutil.rmtree(temp_dir, ignore_errors=True)


@router.post("/raster", response_model=DatasetResponse)
async def upload_raster(
    file: UploadFile = File(...),
    name: str = Form(...),
    description: str = Form(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No filename provided",
        )

    ext = FileProcessor.get_file_extension(file.filename)
    if not FileProcessor.is_raster_file(file.filename):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file format: {ext}. Supported: {FileProcessor.SUPPORTED_RASTER}",
        )

    # Create dataset record first
    dataset_in = DatasetCreate(name=name, description=description)
    dataset = await dataset_crud.create_dataset(
        db,
        dataset_in,
        data_type="raster",
        source_format=ext.lstrip("."),
        created_by_id=current_user.id,
    )

    # Save uploaded file to temp location
    temp_dir = tempfile.mkdtemp()
    temp_path = Path(temp_dir) / file.filename

    try:
        with open(temp_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        # Process the file
        result = await file_processor.process_raster(temp_path, dataset.id)

        # Update dataset with processing results
        dataset.file_path = result["file_path"]
        # Store bounds and other metadata

        await db.commit()
        await db.refresh(dataset)

        return dataset_to_response(dataset)

    except Exception as e:
        # Clean up on error
        await dataset_crud.delete_dataset(db, dataset)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process file: {str(e)}",
        )
    finally:
        # Clean up temp files
        shutil.rmtree(temp_dir, ignore_errors=True)


@router.get("/status/{job_id}", response_model=UploadJobResponse)
async def get_upload_status(
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    job = await dataset_crud.get_upload_job(db, job_id)
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Upload job not found",
        )
    return job
