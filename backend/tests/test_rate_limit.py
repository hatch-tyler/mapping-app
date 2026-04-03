"""Tests for rate limiting."""

import time
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from app.core.rate_limit import RateLimiter, rate_limit_login, rate_limit_password_reset


class TestRateLimiter:
    def test_allows_under_limit(self):
        limiter = RateLimiter(max_requests=5, window_seconds=60)
        # Should not raise for requests under the limit
        for _ in range(5):
            limiter.check("client1")

    def test_blocks_over_limit(self):
        limiter = RateLimiter(max_requests=3, window_seconds=60)
        limiter.check("client1")
        limiter.check("client1")
        limiter.check("client1")
        with pytest.raises(HTTPException) as exc_info:
            limiter.check("client1")
        assert exc_info.value.status_code == 429

    def test_different_keys_independent(self):
        limiter = RateLimiter(max_requests=2, window_seconds=60)
        limiter.check("client1")
        limiter.check("client1")
        # client2 should still be allowed
        limiter.check("client2")
        # client1 should be blocked
        with pytest.raises(HTTPException):
            limiter.check("client1")

    def test_window_expiration(self):
        limiter = RateLimiter(max_requests=2, window_seconds=1)
        limiter.check("client1")
        limiter.check("client1")
        # Wait for window to expire
        time.sleep(1.1)
        # Should be allowed again
        limiter.check("client1")

    def test_cleanup_removes_old_entries(self):
        limiter = RateLimiter(max_requests=10, window_seconds=1)
        for _ in range(5):
            limiter.check("client1")
        time.sleep(1.1)
        # After cleanup, old entries should be gone
        limiter.check("client1")
        assert len(limiter._requests["client1"]) == 1


class TestRateLimitDependencies:
    def test_rate_limit_login_uses_client_ip(self):
        request = MagicMock()
        request.client.host = "192.168.1.1"
        # Should not raise under limit
        rate_limit_login(request)

    def test_rate_limit_password_reset_uses_client_ip(self):
        request = MagicMock()
        request.client.host = "10.0.0.1"
        rate_limit_password_reset(request)

    def test_rate_limit_login_no_client(self):
        request = MagicMock()
        request.client = None
        # Should still work with "unknown" key
        rate_limit_login(request)
