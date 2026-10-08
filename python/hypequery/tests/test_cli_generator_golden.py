"""Golden output of the dataset generator, pinned before structural changes."""

from __future__ import annotations

import json
import os
from pathlib import Path

from hypequery.cli.generators.datasets import generate_datasets
from hypequery.cli.generators.schema import Column, Schema, Table

SNAPSHOT = Path(__file__).parent / "snapshots" / "cli_generated_datasets.json"
UPDATE = os.environ.get("HYPEQUERY_UPDATE_SNAPSHOTS") == "1"

SCHEMA = Schema(
    "analytics",
    (
        Table(
            "order_events",
            (
                Column("order_id", "Nullable(UInt64)"),
                Column("net_amount", "Decimal(18, 2)"),
                Column("created_at", "DateTime64(3, 'UTC')"),
                Column("updated_at", "DateTime"),
                Column("latitude", "Float64"),
                Column("tags", "Array(String)"),
                Column("tenant_id", "String"),
                Column("is_paid", "Bool"),
            ),
        ),
        Table(
            "sessions",
            (
                Column("session_id", "LowCardinality(Nullable(String))"),
                Column("started", "DateTime"),
                Column("ended", "DateTime"),
                Column("duration_ms", "UInt32"),
                Column("org_id", "String"),
            ),
        ),
        Table("lookups", (Column("code", "Nullable(String)"),)),
    ),
)


def _generate() -> dict[str, object]:
    cases: dict[str, object] = {}
    for name, tenant_column in (("plain", None), ("tenant", "tenant_id")):
        generated = generate_datasets(SCHEMA, tenant_column=tenant_column)
        cases[name] = {
            "source": generated.source,
            "snapshot": generated.snapshot,
            "warnings": list(generated.warnings),
            "tables": list(generated.tables),
            "firstDimension": generated.first_dimension,
        }
    return cases


def test_generated_datasets_are_unchanged() -> None:
    current = _generate()
    if UPDATE:
        SNAPSHOT.parent.mkdir(exist_ok=True)
        SNAPSHOT.write_text(json.dumps(current, indent=2) + "\n", encoding="utf-8")
    assert current == json.loads(SNAPSHOT.read_text(encoding="utf-8"))
