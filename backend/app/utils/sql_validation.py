"""Shared SQL identifier validation and escaping utilities.

Used across CRUD, API, and service layers to prevent SQL injection
when building dynamic queries against user-created table/field names.
"""

import re


def validate_table_name(table_name: str) -> bool:
    """Validate table name to prevent SQL injection."""
    return bool(re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", table_name))


def validate_field_name(field_name: str) -> bool:
    """Validate field name for safe use in JSONB SQL queries.

    Allows alphanumeric, spaces, hyphens, dots, and underscores — common in
    real-world GIS data (e.g., "Well Depth", "area-sqmi", "pop.2020").
    Rejects quotes, semicolons, and other SQL-dangerous characters.
    """
    if not field_name or len(field_name) > 255:
        return False
    return bool(re.match(r"^[a-zA-Z0-9_][a-zA-Z0-9_ .\-]*$", field_name))


def escape_field_name(field_name: str) -> str:
    """Escape a field name for safe use in JSONB accessor SQL.

    Doubles any single quotes to prevent SQL injection in properties->>'name' syntax.
    """
    return field_name.replace("'", "''")
