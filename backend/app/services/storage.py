"""
Storage service abstraction for file uploads.
Supports both local filesystem (development) and S3 (production).
"""

import os
import shutil
from abc import ABC, abstractmethod
from pathlib import Path
from typing import BinaryIO
from uuid import UUID

import boto3
from botocore.exceptions import ClientError

from app.config import settings


class StorageBackend(ABC):
    """Abstract base class for storage backends."""

    @abstractmethod
    async def save_file(self, file: BinaryIO, path: str) -> str:
        """Save a file and return its storage path."""
        pass

    @abstractmethod
    async def get_file(self, path: str) -> bytes:
        """Retrieve file contents."""
        pass

    @abstractmethod
    async def delete_file(self, path: str) -> bool:
        """Delete a file. Returns True if successful."""
        pass

    @abstractmethod
    async def file_exists(self, path: str) -> bool:
        """Check if a file exists."""
        pass

    @abstractmethod
    def get_file_url(self, path: str, expires_in: int = 3600) -> str:
        """Get a URL to access the file (presigned for S3, local path for filesystem)."""
        pass


class LocalStorageBackend(StorageBackend):
    """Local filesystem storage for development."""

    def __init__(self, base_path: str = "./uploads"):
        self.base_path = Path(base_path)
        self.base_path.mkdir(parents=True, exist_ok=True)

    async def save_file(self, file: BinaryIO, path: str) -> str:
        full_path = self.base_path / path
        full_path.parent.mkdir(parents=True, exist_ok=True)

        with open(full_path, "wb") as f:
            shutil.copyfileobj(file, f)

        return str(path)

    async def get_file(self, path: str) -> bytes:
        full_path = self.base_path / path
        with open(full_path, "rb") as f:
            return f.read()

    async def delete_file(self, path: str) -> bool:
        full_path = self.base_path / path
        try:
            full_path.unlink()
            return True
        except FileNotFoundError:
            return False

    async def file_exists(self, path: str) -> bool:
        full_path = self.base_path / path
        return full_path.exists()

    def get_file_url(self, path: str, expires_in: int = 3600) -> str:
        # For local development, return a local file path
        return f"/uploads/{path}"


class S3StorageBackend(StorageBackend):
    """AWS S3 storage for production."""

    def __init__(self, bucket_name: str, region: str = "us-east-1"):
        self.bucket_name = bucket_name
        self.region = region
        self.s3_client = boto3.client("s3", region_name=region)

    async def save_file(self, file: BinaryIO, path: str) -> str:
        try:
            self.s3_client.upload_fileobj(
                file,
                self.bucket_name,
                path,
                ExtraArgs={"ServerSideEncryption": "AES256"}
            )
            return path
        except ClientError as e:
            raise RuntimeError(f"Failed to upload file to S3: {e}")

    async def get_file(self, path: str) -> bytes:
        try:
            response = self.s3_client.get_object(
                Bucket=self.bucket_name,
                Key=path
            )
            return response["Body"].read()
        except ClientError as e:
            raise FileNotFoundError(f"File not found in S3: {path}") from e

    async def delete_file(self, path: str) -> bool:
        try:
            self.s3_client.delete_object(
                Bucket=self.bucket_name,
                Key=path
            )
            return True
        except ClientError:
            return False

    async def file_exists(self, path: str) -> bool:
        try:
            self.s3_client.head_object(
                Bucket=self.bucket_name,
                Key=path
            )
            return True
        except ClientError:
            return False

    def get_file_url(self, path: str, expires_in: int = 3600) -> str:
        """Generate a presigned URL for temporary access."""
        try:
            url = self.s3_client.generate_presigned_url(
                "get_object",
                Params={
                    "Bucket": self.bucket_name,
                    "Key": path
                },
                ExpiresIn=expires_in
            )
            return url
        except ClientError as e:
            raise RuntimeError(f"Failed to generate presigned URL: {e}")


def get_storage_backend() -> StorageBackend:
    """
    Factory function to get the appropriate storage backend
    based on environment configuration.
    """
    s3_bucket = os.environ.get("S3_BUCKET")

    if s3_bucket:
        region = os.environ.get("AWS_DEFAULT_REGION", "us-east-1")
        return S3StorageBackend(bucket_name=s3_bucket, region=region)
    else:
        upload_dir = os.environ.get("UPLOAD_DIR", "./uploads")
        return LocalStorageBackend(base_path=upload_dir)


# Singleton instance
_storage_backend: StorageBackend | None = None


def get_storage() -> StorageBackend:
    """Get the storage backend singleton."""
    global _storage_backend
    if _storage_backend is None:
        _storage_backend = get_storage_backend()
    return _storage_backend


def generate_upload_path(dataset_id: UUID, filename: str) -> str:
    """Generate a storage path for an uploaded file."""
    # Structure: datasets/{dataset_id}/{filename}
    return f"datasets/{dataset_id}/{filename}"


def generate_raster_tile_path(dataset_id: UUID, z: int, x: int, y: int) -> str:
    """Generate a storage path for a raster tile."""
    return f"tiles/{dataset_id}/{z}/{x}/{y}.png"
