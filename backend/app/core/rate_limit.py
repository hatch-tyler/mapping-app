"""Simple in-memory rate limiting for auth endpoints.

Uses a sliding-window counter per client IP. Suitable for single-instance
deployments; for multi-instance, switch to Redis-backed rate limiting.
"""

import time
from collections import defaultdict
from threading import Lock

from fastapi import HTTPException, Request, status


class RateLimiter:
    def __init__(self, max_requests: int, window_seconds: int):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._requests: dict[str, list[float]] = defaultdict(list)
        self._lock = Lock()

    def _cleanup(self, key: str, now: float) -> None:
        cutoff = now - self.window_seconds
        self._requests[key] = [t for t in self._requests[key] if t > cutoff]

    def check(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            self._cleanup(key, now)
            if len(self._requests[key]) >= self.max_requests:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Too many requests. Please try again later.",
                )
            self._requests[key].append(now)


# Auth rate limiters
_login_limiter = RateLimiter(max_requests=10, window_seconds=60)
_password_reset_limiter = RateLimiter(max_requests=5, window_seconds=300)


def rate_limit_login(request: Request) -> None:
    """Dependency: limit login attempts to 10 per minute per IP."""
    client_ip = request.client.host if request.client else "unknown"
    _login_limiter.check(client_ip)


def rate_limit_password_reset(request: Request) -> None:
    """Dependency: limit password reset requests to 5 per 5 minutes per IP."""
    client_ip = request.client.host if request.client else "unknown"
    _password_reset_limiter.check(client_ip)
