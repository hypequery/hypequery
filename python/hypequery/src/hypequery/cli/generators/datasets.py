"""Render schema-backed definitions using the TypeScript generator as reference."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass

from hypequery.datasets.validation import validate_identifier
from hypequery.protocol.errors import ProtocolIdentifierError

from ..errors import CliError
from .schema import Schema, Table


@dataclass(frozen=True)
class GeneratedDatasets:
    source: str
    snapshot: str
    warnings: tuple[str, ...]
    tables: tuple[str, ...]
    first_dimension: str


def dimension_type(type_name: str) -> str | None:
    """Classify scalar types; nested types are never guessed to be scalar."""
    value = type_name.strip()
    for _ in range(8):
        match = re.fullmatch(r"(?:Nullable|LowCardinality)\((.*)\)", value)
        if match is None:
            break
        value = match[1].strip()
    if re.fullmatch(r"(?:String|UUID|IPv4|IPv6|FixedString\(\d+\)|Enum(?:8|16)\(.*\))", value):
        return "string"
    if re.fullmatch(
        r"(?:U?Int(?:8|16|32|64|128|256)|Float(?:32|64)|BFloat16|Decimal(?:32|64|128|256)?\(.*\))",
        value,
    ):
        return "number"
    if re.fullmatch(r"(?:Date|Date32|DateTime(?:\(.*\))?|DateTime64\(.*\))", value):
        return "timestamp"
    if value == "Bool":
        return "boolean"
    return None


def is_nullable(type_name: str) -> bool:
    """Whether a column can hold NULL, which `count(column)` would skip."""
    value = type_name.strip()
    for _ in range(8):
        if value.startswith("Nullable("):
            return True
        match = re.fullmatch(r"LowCardinality\((.*)\)", value)
        if match is None:
            return False
        value = match[1].strip()
    return False


def field_name(column: str) -> str:
    """Match TypeScript's camelCase semantic names; physical names stay explicit."""
    first, *rest = column.split("_")
    return first + "".join(part[:1].upper() + part[1:] for part in rest)


def pascal_name(column: str) -> str:
    return "".join(part[:1].upper() + part[1:] for part in column.split("_"))


def is_identifier(name: str) -> bool:
    try:
        validate_identifier(name)
    except (ProtocolIdentifierError, ValueError, TypeError):
        return False
    return True


def measure_candidate(name: str) -> bool:
    lower = name.lower()
    return not (
        lower
        in {
            "id",
            "uuid",
            "tenant_id",
            "organization_id",
            "org_id",
            "account_id",
            "customer_id",
            "lat",
            "lng",
            "lon",
            "latitude",
            "longitude",
        }
        or lower.endswith("_id")
        or name.endswith("Id")
        or "uuid" in lower
        or any(
            lower.endswith("_" + suffix)
            for suffix in ("lat", "lng", "lon", "latitude", "longitude")
        )
    )


#: Measures suggested for each numeric value column: name prefix, aggregation, label.
_NUMERIC_MEASURES = (("total", "sum", "Total"), ("avg", "avg", "Average"))
#: Column names that suggest tenancy. Reported for review, never applied.
_TENANT_HINTS = frozenset(("tenant_id", "organization_id", "org_id", "account_id", "customer_id"))


@dataclass(frozen=True, slots=True)
class FieldSpec:
    """One generated dimension: its physical column, semantic alias and type."""

    column: str
    alias: str
    kind: str


@dataclass(frozen=True, slots=True)
class MeasureSpec:
    name: str
    aggregation: str
    field: str
    label: str


@dataclass(frozen=True, slots=True)
class DatasetSpec:
    """Everything inferred for one table, before any source is rendered."""

    table: str
    source: str
    time_key: str | None
    tenant_key: str | None
    fields: tuple[FieldSpec, ...]
    #: The column-backed row count; see `_count_field`.
    count_field: str
    measures: tuple[MeasureSpec, ...]


def _label(column: str) -> str:
    return column.replace("_", " ").title()


def _time_key(fields: tuple[FieldSpec, ...]) -> str | None:
    """`created_at` when present, else the only timestamp, else none."""

    timestamps = [field.column for field in fields if field.kind == "timestamp"]
    if "created_at" in timestamps:
        return "created_at"
    return timestamps[0] if len(timestamps) == 1 else None


def infer_dataset(
    table: Table, database: str, *, tenant_column: str | None, warnings: list[str]
) -> DatasetSpec:
    """Infer one dataset from catalog metadata, appending review warnings in order."""

    if not is_identifier(table.name):
        raise CliError(f"Table {table.name!r} is outside the SDK's supported identifier grammar.")
    fields: list[FieldSpec] = []
    non_nullable: list[str] = []
    seen: set[str] = set()
    for column in table.columns:
        kind = dimension_type(column.type)
        alias = field_name(column.name)
        if kind is None or not is_identifier(column.name) or not is_identifier(alias):
            warnings.append(
                f"{table.name}.{column.name}: unsupported column ({column.type}); omitted."
            )
            continue
        if alias in seen or alias == "totalCount":
            raise CliError(
                f"Semantic name collision in {table.name!r}: {alias!r}; rename or map explicitly."
            )
        seen.add(alias)
        fields.append(FieldSpec(column.name, alias, kind))
        if not is_nullable(column.type):
            non_nullable.append(alias)
    if not fields:
        raise CliError(f"Table {table.name!r} has no supported scalar dimensions.")

    time_key = _time_key(tuple(fields))
    if time_key is None and sum(field.kind == "timestamp" for field in fields) > 1:
        warnings.append(f"{table.name}: multiple timestamp columns; set time_key explicitly.")
    columns = {field.column for field in fields}
    tenant_key = tenant_column if tenant_column in columns else None
    if tenant_column is not None and tenant_key is None:
        warnings.append(
            f"{table.name}: no {tenant_column!r} column, so tenant isolation was not "
            "applied; set tenant_key to the correct column before serving tenant requests."
        )
    hints = [field.column for field in fields if field.column.lower() in _TENANT_HINTS]
    if hints and tenant_key is None:
        warnings.append(
            f"{table.name}: possible tenant columns {', '.join(hints)}; "
            "configure trusted tenant scope and tenant_key explicitly."
        )

    measures: list[MeasureSpec] = []
    for field in fields:
        if field.kind != "number" or not measure_candidate(field.column):
            continue
        for prefix, aggregation, description in (
            ("total", "sum", "Total"),
            ("avg", "avg", "Average"),
        ):
            name = prefix + pascal_name(field.column)
            if name in seen:
                raise CliError(
                    f"Semantic name collision in {table.name!r}: {name!r}; map explicitly."
                )
            seen.add(name)
            measures.append(
                MeasureSpec(name, aggregation, field.alias, f"{description} {_label(field.column)}")
            )
    return DatasetSpec(
        table=table.name,
        source=f"{database}.{table.name}",
        time_key=time_key,
        tenant_key=tenant_key,
        fields=tuple(fields),
        # Column-backed, as TypeScript generates it, so the definition deploys and
        # composes with relationship joins. A non-nullable column keeps it a row
        # count; `count` skips NULLs, so a nullable one is only the fallback.
        count_field=non_nullable[0] if non_nullable else fields[0].alias,
        measures=tuple(measures),
    )


def render_datasets(specs: tuple[DatasetSpec, ...]) -> str:
    """Python source defining *specs*; every value is written with `repr`."""

    lines = [
        "# Generated from ClickHouse catalog metadata; review suggested measures.",
        "from hypequery.datasets import dataset, dimension, measure",
        "",
        "datasets = {",
    ]
    for spec in specs:
        lines.extend(
            [
                f"    {spec.table!r}: dataset(",
                f"        name={spec.table!r},",
                f"        source={spec.source!r},",
            ]
        )
        if spec.time_key:
            lines.append(f"        time_key={spec.time_key!r},")
        if spec.tenant_key:
            lines.append(f"        tenant_key={spec.tenant_key!r},")
        lines.append("        dimensions={")
        for field in spec.fields:
            lines.append(
                f"            {field.alias!r}: dimension.{field.kind}"
                f"(column={field.column!r}, label={_label(field.column)!r}),"
            )
        lines.extend(["        },", "        measures={"])
        lines.append(
            f'            "totalCount": measure.count({spec.count_field!r}, label="Total Count"),'
        )
        for item in spec.measures:
            lines.append(
                f"            {item.name!r}: measure.{item.aggregation}({item.field!r}, "
                f"label={item.label!r}),"
            )
        lines.extend(["        },", "    ),"])
    lines.extend(["}", ""])
    return "\n".join(lines)


def generate_datasets(schema: Schema, *, tenant_column: str | None = None) -> GeneratedDatasets:
    """Preserve source mappings, avoid collisions, and report unsupported fields.

    Only an explicit *tenant_column* sets ``tenant_key``; column-name matches are
    reported for review and never become policy.
    """
    if tenant_column is not None and not is_identifier(tenant_column):
        raise CliError("The tenant column is outside the SDK's supported identifier grammar.")
    if not is_identifier(schema.database):
        raise CliError("The database name is outside the SDK's supported identifier grammar.")
    if not schema.tables:
        raise CliError("No tables selected.")
    warnings: list[str] = []
    specs = tuple(
        infer_dataset(table, schema.database, tenant_column=tenant_column, warnings=warnings)
        for table in schema.tables
    )
    snapshot = [
        {
            "table": table.name,
            "columns": [{"name": column.name, "type": column.type} for column in table.columns],
        }
        for table in schema.tables
    ]
    return GeneratedDatasets(
        render_datasets(specs),
        json.dumps(
            {"database": schema.database, "tables": snapshot, "warnings": warnings}, indent=2
        )
        + "\n",
        tuple(warnings),
        tuple(table.name for table in schema.tables),
        specs[0].fields[0].alias,
    )
