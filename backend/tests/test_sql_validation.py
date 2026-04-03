"""Tests for SQL identifier validation and escaping."""

from app.utils.sql_validation import (
    validate_table_name,
    validate_field_name,
    escape_field_name,
)


class TestValidateTableName:
    def test_valid_simple(self):
        assert validate_table_name("my_table") is True

    def test_valid_with_numbers(self):
        assert validate_table_name("data_2024") is True

    def test_valid_underscore_start(self):
        assert validate_table_name("_private") is True

    def test_invalid_starts_with_number(self):
        assert validate_table_name("123start") is False

    def test_invalid_sql_injection(self):
        assert validate_table_name("; DROP TABLE users") is False

    def test_invalid_quoted(self):
        assert validate_table_name('"quoted"') is False

    def test_invalid_semicolon(self):
        assert validate_table_name("table;") is False

    def test_invalid_space(self):
        assert validate_table_name("my table") is False

    def test_invalid_hyphen(self):
        assert validate_table_name("my-table") is False

    def test_invalid_empty(self):
        assert validate_table_name("") is False


class TestValidateFieldName:
    def test_valid_simple(self):
        assert validate_field_name("Well Depth") is True

    def test_valid_hyphen(self):
        assert validate_field_name("area-sqmi") is True

    def test_valid_dot(self):
        assert validate_field_name("pop.2020") is True

    def test_valid_underscore(self):
        assert validate_field_name("field_name") is True

    def test_invalid_single_quote(self):
        assert validate_field_name("field'; --") is False

    def test_invalid_double_quote(self):
        assert validate_field_name('a"b') is False

    def test_invalid_semicolon(self):
        assert validate_field_name("field;") is False

    def test_invalid_empty(self):
        assert validate_field_name("") is False

    def test_invalid_too_long(self):
        assert validate_field_name("x" * 256) is False

    def test_valid_at_max_length(self):
        assert validate_field_name("x" * 255) is True

    def test_invalid_starts_with_space(self):
        assert validate_field_name(" leading") is False

    def test_invalid_starts_with_dot(self):
        assert validate_field_name(".dotstart") is False


class TestEscapeFieldName:
    def test_no_quotes(self):
        assert escape_field_name("normal") == "normal"

    def test_single_quote(self):
        assert escape_field_name("O'Brien") == "O''Brien"

    def test_multiple_quotes(self):
        assert escape_field_name("it's Bob's") == "it''s Bob''s"

    def test_empty(self):
        assert escape_field_name("") == ""
