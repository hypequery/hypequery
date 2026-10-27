"""The Python CLI on Postgres: discovery, generation and the scaffolded project."""

from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path

import pytest

from hypequery.cli import main
from hypequery.cli.generators.datasets import column_is_nullable, dimension_type, generate_datasets
from hypequery.cli.generators.project import schema_templates
from hypequery.cli.generators.schema import Column, Schema, Table
from hypequery.cli.options import resolve_database
from hypequery.cli.utils.templates import load_templates

POSTGRES_URL = os.environ.get("HYPEQUERY_TEST_POSTGRES_URL")

ORDERS = Table(
    "orders",
    (
        Column("id", "bigint", False),
        Column("status", "USER-DEFINED", True),
        Column("amount", "numeric", True),
        Column("is_gift", "boolean", False),
        Column("created_at", "timestamp with time zone", False),
        Column("tags", "ARRAY", True),
    ),
)


def test_the_engine_is_the_flag_else_detected_from_the_environment() -> None:
    assert resolve_database("clickhouse", {"DATABASE_URL": "postgres://h/db"}) == "clickhouse"
    assert resolve_database(None, {"HYPEQUERY_POSTGRES_URL": "postgresql://h/db"}) == "postgres"
    assert resolve_database(None, {"DATABASE_URL": "postgres://h/db"}) == "postgres"
    assert resolve_database(None, {"DATABASE_URL": "mysql://h/db"}) == "clickhouse"
    both = {"DATABASE_URL": "postgres://h/db", "CLICKHOUSE_HOST": "localhost"}
    assert resolve_database(None, both) == "clickhouse"


def test_postgres_types_and_nullability_come_from_the_catalog() -> None:
    assert dimension_type("double precision", "postgres") == "number"
    assert dimension_type("timestamp without time zone", "postgres") == "timestamp"
    assert dimension_type("USER-DEFINED", "postgres") == "string"
    assert dimension_type("ARRAY", "postgres") is None
    assert dimension_type("jsonb", "postgres") is None
    assert column_is_nullable(Column("id", "bigint", False), "postgres") is False
    assert column_is_nullable(Column("id", "Nullable(Int64)")) is True


def test_generates_postgres_datasets_and_a_postgres_project() -> None:
    schema = Schema("public", (ORDERS,), "postgres")
    generated = generate_datasets(schema)
    assert "source='public.orders'" in generated.source
    assert "time_key='created_at'" in generated.source
    assert any("orders.tags: unsupported column (ARRAY)" in w for w in generated.warnings)
    assert generated.source.startswith("# Generated from Postgres catalog metadata")
    # The first non-nullable column backs the row count.
    assert "measure.count('id', label=\"Total Count\")" in generated.source

    files = schema_templates(load_templates(), schema, generated)
    assert "create_postgres_executor(PostgresConnection.from_env())" in files["app.py"]
    assert "ClickHouse" not in files["app.py"]
    assert "hypequery[fastapi,postgres]" in files["pyproject.toml"]
    assert "HYPEQUERY_POSTGRES_URL=" in files[".env.example"]
    assert "CLICKHOUSE" not in files["README.md"]


def test_the_offline_example_stays_clickhouse_only(tmp_path: Path) -> None:
    code = main(["init", str(tmp_path / "project"), "--database", "postgres", "--skip-connection"])
    assert code == 1


@pytest.mark.skipif(POSTGRES_URL is None, reason="no live Postgres")
def test_init_scaffolds_a_project_that_queries_postgres(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import psycopg

    schema = "hq_py_cli"
    assert POSTGRES_URL is not None
    with psycopg.connect(POSTGRES_URL, autocommit=True) as connection:
        connection.execute(f"DROP SCHEMA IF EXISTS {schema} CASCADE")
        connection.execute(f"CREATE SCHEMA {schema}")
        connection.execute(
            f"CREATE TABLE {schema}.orders (id bigint NOT NULL, status text, "
            "amount numeric, created_at timestamptz NOT NULL)"
        )
        connection.execute(
            f"INSERT INTO {schema}.orders VALUES (1, 'paid', 10.5, '2026-01-01T10:00Z'), "  # noqa: S608
            "(2, 'paid', 4.5, '2026-01-02T10:00Z'), (3, 'void', 1, '2026-01-02T11:00Z')"
        )
    try:
        # The URL selects the schema, so discovery reads only it.
        url = (
            POSTGRES_URL
            + ("&" if "?" in POSTGRES_URL else "?")
            + f"options=-csearch_path%3D{schema}"
        )
        monkeypatch.setenv("HYPEQUERY_POSTGRES_URL", url)
        for name in [name for name in os.environ if name.startswith("CLICKHOUSE_")]:
            monkeypatch.delenv(name)
        project = tmp_path / "project"
        assert main(["init", str(project)]) == 0
        assert main(["generate", "datasets", "--path", str(project), "--check"]) == 0

        spec = importlib.util.spec_from_file_location("generated_datasets", project / "datasets.py")
        assert spec is not None
        assert spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        sys.modules["generated_datasets"] = module
        spec.loader.exec_module(module)

        from hypequery.datasets import create_dataset_client, create_dataset_registry
        from hypequery.execution import create_postgres_executor

        datasets = module.datasets
        client = create_dataset_client(
            executor=create_postgres_executor(url),
            registry=create_dataset_registry(*datasets.values()),
        )
        result = client.execute(
            datasets["orders"],
            {
                "dimensions": ["status"],
                "measures": ["totalAmount"],
                "order_by": [{"field": "status", "direction": "asc"}],
            },
            use_cache=False,
        )
        assert result.data == (
            {"status": "paid", "totalAmount": 15.0},
            {"status": "void", "totalAmount": 1},
        )
    finally:
        sys.modules.pop("generated_datasets", None)
        with psycopg.connect(POSTGRES_URL, autocommit=True) as connection:
            connection.execute(f"DROP SCHEMA IF EXISTS {schema} CASCADE")
