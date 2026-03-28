"""Tests for ESRI query handler."""

import pytest

from app.services.arcgis.query_handler import slugify


# ── Pure Function Tests ───────────────────────────────────────────────


class TestSlugify:
    @pytest.mark.parametrize(
        "input_name,expected",
        [
            ("Simple Name", "simple_name"),
            ("Hello World", "hello_world"),
            ("already_slugified", "already_slugified"),
            ("MixedCase", "mixedcase"),
            ("with-dashes", "with_dashes"),
            ("  extra  spaces  ", "extra_spaces"),
            ("special!@#chars", "specialchars"),
            ("multiple---dashes", "multiple_dashes"),
            ("dots.in.name", "dotsinname"),
            ("UPPERCASE", "uppercase"),
            ("123 Numbers", "123_numbers"),
            ("under_score", "under_score"),
            ("a", "a"),
        ],
    )
    def test_slugify(self, input_name, expected):
        assert slugify(input_name) == expected
