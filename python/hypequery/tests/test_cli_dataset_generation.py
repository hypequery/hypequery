"""Compare schema-backed definitions with the TypeScript generator contract."""

from __future__ import annotations

import importlib.util
import json
import shutil
import subprocess
import sys
import tomllib
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import cast

import pytest

from hypequery.cli import main
from hypequery.cli.errors import CliError
from hypequery.cli.generators.datasets import dimension_type, generate_datasets, is_nullable
from hypequery.cli.generators.project import schema_templates
from hypequery.cli.generators.schema import Column, Schema, Table, read_schema
from hypequery.cli.utils.templates import load_templates
from hypequery.datasets import (
    Dataset,
    DatasetQuery,
    DerivedMeasure,
    build_protocol_deployment_contract,
    create_dataset_registry,
    plan_dataset_query,
)


@pytest.mark.parametrize(
    ("physical", "semantic"),
    [
        ("String", "string"),
        ("LowCardinality(Nullable(String))", "string"),
        ("Nullable(UInt64)", "number"),
        ("Decimal(18, 2)", "number"),
        ("Bool", "boolean"),
        ("DateTime64(3, 'UTC')", "timestamp"),
        ("UUID", "string"),
        ("Enum8('a'=1, 'b'=2)", "string"),
        ("Array(UInt64)", None),
        ("Map(String, Int64)", None),
        ("Tuple(Int32, String)", None),
        ("AggregateFunction(sum, UInt64)", None),
    ],
)
def test_physical_type_mapping(physical: str, semantic: str | None) -> None:
    assert dimension_type(physical) == semantic


def fixture_schema() -> Schema:
    return Schema(
        "analytics",
        (
            Table(
                "order_events",
                (
                    Column("order_id", "Nullable(UInt64)"),
                    Column("net_amount", "Decimal(18, 2)"),
                    Column("created_at", "DateTime64(3, 'UTC')"),
                    Column("latitude", "Float64"),
                    Column("tags", "Array(String)"),
                    Column("tenant_id", "String"),
                ),
            ),
        ),
    )


def test_generated_definitions_compile_and_preserve_source_schema(tmp_path: Path) -> None:
    schema = fixture_schema()
    generated = generate_datasets(schema)
    path = tmp_path / "datasets.py"
    path.write_text(generated.source)
    spec = importlib.util.spec_from_file_location("generated_test", path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    model = cast(dict[str, Dataset], module.datasets)["order_events"]
    assert model.source == "analytics.order_events"
    assert model.time_key == "created_at"
    assert model.tenant_key is None
    assert model.dimensions["orderId"].column == "order_id"
    assert model.dimensions["netAmount"].field_type == "number"
    assert set(model.measures) == {"totalCount", "totalNetAmount", "avgNetAmount"}
    compiled = plan_dataset_query(model, DatasetQuery(measures=("totalCount", "totalNetAmount")))
    # order_id is Nullable, so the row count uses the first non-nullable column.
    assert "count(`net_amount`)" in compiled.sql
    assert "sum(`net_amount`)" in compiled.sql
    assert "`analytics`.`order_events`" in compiled.sql
    assert len(generated.warnings) == 2
    snapshot = json.loads(generated.snapshot)
    assert snapshot["tables"][0]["columns"][4] == {"name": "tags", "type": "Array(String)"}


def _load(source: str, tmp_path: Path) -> dict[str, Dataset]:
    path = tmp_path / "datasets.py"
    path.write_text(source)
    spec = importlib.util.spec_from_file_location("generated_roundtrip", path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return cast(dict[str, Dataset], module.datasets)


def test_generated_definitions_build_a_deployment_contract(tmp_path: Path) -> None:
    datasets = _load(generate_datasets(fixture_schema()).source, tmp_path)
    contract = build_protocol_deployment_contract(create_dataset_registry(*datasets.values()))
    measures = cast(
        list[dict[str, object]], cast(list[dict[str, object]], contract["datasets"])[0]["measures"]
    )
    total = next(item for item in measures if item["name"] == "totalCount")
    assert total["aggregation"] == "count"
    assert total["field"] == "netAmount"
    assert "sql" not in total


def test_total_count_falls_back_to_a_nullable_column(tmp_path: Path) -> None:
    schema = Schema(
        "analytics",
        (Table("events", (Column("user_id", "LowCardinality(Nullable(String))"),)),),
    )
    model = _load(generate_datasets(schema).source, tmp_path)["events"]
    total = model.measures["totalCount"]
    assert not isinstance(total, DerivedMeasure)
    assert total.field == "userId"
    assert total.sql is None


@pytest.mark.parametrize(
    ("physical", "nullable"),
    [
        ("Nullable(UInt64)", True),
        ("LowCardinality(Nullable(String))", True),
        ("LowCardinality(String)", False),
        ("Array(Nullable(String))", False),
        ("UInt64", False),
    ],
)
def test_nullable_detection(physical: str, nullable: bool) -> None:
    assert is_nullable(physical) is nullable


def test_name_collisions_and_unsupported_tables_fail_explicitly() -> None:
    for columns in (
        (Column("a_b", "String"), Column("aB", "String")),
        (Column("tags", "Array(String)"),),
    ):
        with pytest.raises(CliError):
            generate_datasets(Schema("analytics", (Table("orders", columns),)))
    with pytest.raises(CliError):
        generate_datasets(Schema("analytics", (Table("bad table", (Column("id", "String"),)),)))


@dataclass
class Result:
    result_rows: list[tuple[object, ...]]


@dataclass
class Client:
    calls: list[tuple[str, dict[str, object]]] = field(default_factory=list)

    def query(
        self, query: str, *, parameters: dict[str, object], settings: dict[str, int]
    ) -> Result:
        assert settings["readonly"] == 1
        self.calls.append((query, parameters))
        if "currentDatabase" in query:
            return Result([("analytics",)])
        if "system.tables" in query:
            return Result([("orders",), ("users",), (".inner.hidden",)])
        return Result([("orders", "id", "String")])

    def close(self) -> None:
        pass


def test_table_selection_is_exact_and_parameterized() -> None:
    client = Client()
    schema = read_schema(client, tables=" orders,users ", exclude_tables="users")
    assert tuple(table.name for table in schema.tables) == ("orders",)
    assert client.calls[-1][1] == {"database": "analytics", "tables": ["orders"]}
    with pytest.raises(CliError, match="do not exist"):
        read_schema(client, tables="missing", exclude_tables=None)


def test_real_schema_init_does_not_seed_or_store_credentials(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "hypequery.cli.generators.schema.discover_schema", lambda **kwargs: fixture_schema()
    )
    monkeypatch.setenv("CLICKHOUSE_PASSWORD", "private-password")
    assert main(["init", "--path", str(tmp_path), "--tables", "order_events"]) == 0
    assert (tmp_path / "datasets.py").exists()
    assert (tmp_path / "schema.json").exists()
    assert not (tmp_path / "seed.sql").exists()
    for path in tmp_path.iterdir():
        assert "private-password" not in path.read_text()
    assert "for name, definition in datasets.items()" in (tmp_path / "app.py").read_text()


def test_generation_failure_does_not_leave_a_partial_project(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail(**kwargs: object) -> Schema:
        raise CliError("Cannot inspect ClickHouse")

    monkeypatch.setattr("hypequery.cli.generators.schema.discover_schema", fail)
    destination = tmp_path / "generated"
    assert main(["init", str(destination)]) == 1
    assert not destination.exists()


def test_generated_app_uses_the_generated_registry() -> None:
    schema = fixture_schema()
    templates = schema_templates(load_templates(), schema, generate_datasets(schema))
    assert "registry = create_dataset_registry(*datasets.values())" in templates["app.py"]


def test_schema_project_wheel_contains_both_modules(tmp_path: Path) -> None:
    schema = fixture_schema()
    templates = schema_templates(load_templates(), schema, generate_datasets(schema))
    assert tomllib.loads(templates["pyproject.toml"])["tool"]["setuptools"]["py-modules"] == [
        "app",
        "datasets",
    ]
    for name, content in templates.items():
        (tmp_path / name).write_text(content)
    uv = shutil.which("uv")
    assert uv is not None
    subprocess.run(
        [uv, "build", "--wheel", "--out-dir", str(tmp_path / "dist"), str(tmp_path)],
        check=True,
        capture_output=True,
        text=True,
    )
    wheel = next((tmp_path / "dist").glob("*.whl"))
    with zipfile.ZipFile(wheel) as archive:
        assert {"app.py", "datasets.py"} <= set(archive.namelist())
        archive.extractall(tmp_path / "installed")
    subprocess.run(
        [sys.executable, "-c", "import datasets; assert 'order_events' in datasets.datasets"],
        cwd=tmp_path / "installed",
        check=True,
        capture_output=True,
        text=True,
    )


@pytest.mark.parametrize(
    ("name", "value"), [("CLICKHOUSE_SECURE", "sometimes"), ("CLICKHOUSE_PORT", "http")]
)
def test_discovery_names_a_malformed_connection_variable(
    monkeypatch: pytest.MonkeyPatch, name: str, value: str
) -> None:
    from hypequery.cli.generators.schema import discover_schema

    monkeypatch.setenv(name, value)
    with pytest.raises(CliError, match=name) as caught:
        discover_schema(tables=None, exclude_tables=None)
    # The generic "check credentials" message would send users the wrong way,
    # and the rejected value is never echoed.
    assert "Cannot inspect ClickHouse" not in str(caught.value)
    assert value not in str(caught.value)
