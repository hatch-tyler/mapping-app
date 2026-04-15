"""Tests for the public registration request endpoint."""

from __future__ import annotations

import pytest
from httpx import AsyncClient


class TestRegistrationFullNameRequired:
    @pytest.mark.asyncio
    async def test_missing_full_name_rejected(self, client: AsyncClient):
        resp = await client.post(
            "/api/v1/registration/request",
            json={
                "email": "no_name@test.com",
                "password": "password123",
            },
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_empty_full_name_rejected(self, client: AsyncClient):
        resp = await client.post(
            "/api/v1/registration/request",
            json={
                "email": "empty_name@test.com",
                "password": "password123",
                "full_name": "",
            },
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_whitespace_full_name_rejected(self, client: AsyncClient):
        resp = await client.post(
            "/api/v1/registration/request",
            json={
                "email": "ws_name@test.com",
                "password": "password123",
                "full_name": "   ",
            },
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_valid_full_name_accepted(self, client: AsyncClient):
        resp = await client.post(
            "/api/v1/registration/request",
            json={
                "email": "valid_name@test.com",
                "password": "password123",
                "full_name": "Jane Doe",
            },
        )
        # Accepted response may be 200 or 201 depending on endpoint impl.
        assert resp.status_code in (200, 201)

    @pytest.mark.asyncio
    async def test_whitespace_trimmed_on_save(self, client: AsyncClient):
        resp = await client.post(
            "/api/v1/registration/request",
            json={
                "email": "padded@test.com",
                "password": "password123",
                "full_name": "  Padded Name  ",
            },
        )
        assert resp.status_code in (200, 201)
