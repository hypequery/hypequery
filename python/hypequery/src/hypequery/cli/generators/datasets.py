"""Render schema-backed definitions using the TypeScript generator as reference."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass

from hypequery.datasets.validation import validate_identifier
from hypequery.protocol.errors import ProtocolIdentifierError

from ..errors import CliError
from .schema import Schema


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


def generate_datasets(schema: Schema) -> GeneratedDatasets:
    """Preserve source mappings, avoid collisions, and report unsupported fields."""
    if not is_identifier(schema.database):
        raise CliError("The database name is outside the SDK's supported identifier grammar.")
    lines = [
        "# Generated from ClickHouse catalog metadata; review suggested measures.",
        "from hypequery.datasets import dataset, dimension, measure",
        "",
        "datasets = {",
    ]
    warnings: list[str] = []
    first_dimension = ""
    snapshot = []
    for table in schema.tables:
        if not is_identifier(table.name):
            raise CliError(
                f"Table {table.name!r} is outside the SDK's supported identifier grammar."
            )
        fields: list[tuple[str, str, str]] = []
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
                    f"Semantic name collision in {table.name!r}: {alias!r}; "
                    "rename or map explicitly."
                )
            seen.add(alias)
            fields.append((column.name, alias, kind))
        if not fields:
            raise CliError(f"Table {table.name!r} has no supported scalar dimensions.")
        if not first_dimension:
            first_dimension = fields[0][1]
        timestamps = [column for column, _, kind in fields if kind == "timestamp"]
        time_key = (
            "created_at"
            if "created_at" in timestamps
            else timestamps[0]
            if len(timestamps) == 1
            else None
        )
        if len(timestamps) > 1 and time_key is None:
            warnings.append(f"{table.name}: multiple timestamp columns; set time_key explicitly.")
        tenants = [
            column
            for column, _, _ in fields
            if column.lower()
            in {"tenant_id", "organization_id", "org_id", "account_id", "customer_id"}
        ]
        if tenants:
            warnings.append(
                f"{table.name}: possible tenant columns {', '.join(tenants)}; "
                "configure trusted tenant scope and tenant_key explicitly."
            )
        lines.extend(
            [
                f"    {table.name!r}: dataset(",
                f"        name={table.name!r},",
                f"        source={f'{schema.database}.{table.name}'!r},",
            ]
        )
        if time_key:
            lines.append(f"        time_key={time_key!r},")
        lines.append("        dimensions={")
        for physical, alias, kind in fields:
            label = physical.replace("_", " ").title()
            lines.append(
                f"            {alias!r}: dimension.{kind}(column={physical!r}, label={label!r}),"
            )
        lines.extend(
            [
                "        },",
                "        measures={",
                '            "totalCount": measure.count("rows", sql="1", label="Total Count"),',
            ]
        )
        for physical, alias, kind in fields:
            if kind != "number" or not measure_candidate(physical):
                continue
            label = physical.replace("_", " ").title()
            for prefix, aggregation, description in [
                ("total", "sum", "Total"),
                ("avg", "avg", "Average"),
            ]:
                name = prefix + pascal_name(physical)
                if name in seen:
                    raise CliError(
                        f"Semantic name collision in {table.name!r}: {name!r}; map explicitly."
                    )
                seen.add(name)
                lines.append(
                    f"            {name!r}: measure.{aggregation}({alias!r}, "
                    f"label={f'{description} {label}'!r}),"
                )
        lines.extend(["        },", "    ),"])
        snapshot.append(
            {
                "table": table.name,
                "columns": [{"name": column.name, "type": column.type} for column in table.columns],
            }
        )
    lines.extend(["}", ""])
    if not snapshot:
        raise CliError("No tables selected.")
    return GeneratedDatasets(
        "\n".join(lines),
        json.dumps(
            {"database": schema.database, "tables": snapshot, "warnings": warnings}, indent=2
        )
        + "\n",
        tuple(warnings),
        tuple(table.name for table in schema.tables),
        first_dimension,
    )
