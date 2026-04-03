"""Tests for SSRF URL validation."""

from unittest.mock import patch

import pytest

from app.services.external_source import _validate_url_not_internal


class TestValidateUrlNotInternal:
    def test_reject_localhost(self):
        with pytest.raises(ValueError, match="localhost"):
            _validate_url_not_internal("http://localhost/api")

    def test_reject_127_0_0_1(self):
        with pytest.raises(ValueError, match="localhost"):
            _validate_url_not_internal("http://127.0.0.1:8080/data")

    def test_reject_0_0_0_0(self):
        with pytest.raises(ValueError, match="localhost"):
            _validate_url_not_internal("http://0.0.0.0/")

    def test_reject_ipv6_loopback(self):
        with pytest.raises(ValueError, match="localhost"):
            _validate_url_not_internal("http://[::1]/api")

    def test_reject_no_hostname(self):
        with pytest.raises(ValueError, match="no hostname"):
            _validate_url_not_internal("not-a-url")

    def test_reject_unresolvable(self):
        with pytest.raises(ValueError, match="Cannot resolve"):
            _validate_url_not_internal("http://this-host-does-not-exist-12345.invalid/")

    @patch("app.services.external_source.socket.getaddrinfo")
    def test_reject_private_10_network(self, mock_dns):
        mock_dns.return_value = [
            (2, 1, 6, "", ("10.0.0.1", 0)),
        ]
        with pytest.raises(ValueError, match="non-public"):
            _validate_url_not_internal("http://internal.company.com/api")

    @patch("app.services.external_source.socket.getaddrinfo")
    def test_reject_private_172_network(self, mock_dns):
        mock_dns.return_value = [
            (2, 1, 6, "", ("172.16.0.1", 0)),
        ]
        with pytest.raises(ValueError, match="non-public"):
            _validate_url_not_internal("http://internal.company.com/api")

    @patch("app.services.external_source.socket.getaddrinfo")
    def test_reject_private_192_168(self, mock_dns):
        mock_dns.return_value = [
            (2, 1, 6, "", ("192.168.1.100", 0)),
        ]
        with pytest.raises(ValueError, match="non-public"):
            _validate_url_not_internal("http://router.local/admin")

    @patch("app.services.external_source.socket.getaddrinfo")
    def test_reject_link_local(self, mock_dns):
        mock_dns.return_value = [
            (2, 1, 6, "", ("169.254.169.254", 0)),
        ]
        with pytest.raises(ValueError, match="non-public"):
            _validate_url_not_internal("http://metadata.google.internal/")

    @patch("app.services.external_source.socket.getaddrinfo")
    def test_allow_public_ip(self, mock_dns):
        mock_dns.return_value = [
            (2, 1, 6, "", ("93.184.216.34", 0)),
        ]
        # Should NOT raise
        _validate_url_not_internal("http://example.com/api")
