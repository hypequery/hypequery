#!/usr/bin/env python3
"""Prove that no caller value reaches SQL text.

The planner is the only thing in the package that builds SQL, and RFC 0010
says a value moves as a typed parameter and never as text. That is a property
worth checking mechanically rather than reviewing, so this runs two
independent checks and fails on either.

**Structural.** Parse every module under `datasets/planner/` and reject a
value-bearing expression appearing inside an f-string. A value must be bound to
a placeholder first, so the name that reaches the format string is the
placeholder and never the data. Ruff's S608 is the other half of this: it bans
the classic interpolated-SQL shape, and this bans the shape S608 cannot see,
where the interpolation is a call whose argument is the value.

**Behavioural.** Plan the same query twice with two different values and assert
the statement is byte-identical both times. This is the property itself rather
than a proxy for it: if any value reached the text, the two statements would
differ. A substring search would miss a value that arrives re-encoded, and
would false-positive on a value that happens to look like a placeholder.
Hostile values are also searched for directly, which catches a value landing
somewhere the equality check cannot see.
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLANNER = ROOT / "src" / "hypequery" / "datasets" / "planner"

#: Names that carry caller data. None may be read inside an f-string.
VALUE_BEARING = frozenset(("value", "values", "ids", "item", "items"))

#: Hostile values the behavioural check binds. Each is chosen to break out of a
#: string literal, an identifier, or the statement, if anything interpolated it.
#: The last two are the placeholder syntaxes themselves: a value that looks like
#: a placeholder must not be able to forge or shadow one.
HOSTILE = (
    "' OR 1=1 --",
    '"; DROP TABLE trips; --',
    "`); SELECT 1 --",
    "\\'",
    "a\u0000b",
    "{p0:String}",
    "<p0:String>",
)

#: Values that cannot be confused with planner syntax, so a plain substring
#: search over the statement is meaningful for them.
SEARCHABLE = tuple(value for value in HOSTILE if "{" not in value and "<" not in value)

#: A second value for the same query shape. The statement must not change.
BENIGN = "acme"


def _value_bearing_names(node: ast.AST) -> set[str]:
    """Every value-bearing name or attribute read anywhere under *node*."""

    found: set[str] = set()
    for child in ast.walk(node):
        if isinstance(child, ast.Name) and child.id in VALUE_BEARING:
            found.add(child.id)
        elif isinstance(child, ast.Attribute) and child.attr in VALUE_BEARING:
            found.add(f".{child.attr}")
    return found


def check_structure() -> list[str]:
    """Report every f-string in the planner that reads caller data."""

    failures: list[str] = []
    for path in sorted(PLANNER.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        # A message that reports a rejected value is not SQL and never becomes
        # any, so the rule is scoped to f-strings outside `raise`.
        in_raise = {
            id(inner)
            for node in ast.walk(tree)
            if isinstance(node, ast.Raise)
            for inner in ast.walk(node)
        }
        for node in ast.walk(tree):
            if not isinstance(node, ast.JoinedStr) or id(node) in in_raise:
                continue
            for part in node.values:
                if not isinstance(part, ast.FormattedValue):
                    continue
                names = _value_bearing_names(part.value)
                if names:
                    failures.append(
                        f"{path.relative_to(ROOT)}:{node.lineno}: f-string reads "
                        f"{', '.join(sorted(names))} — bind it to a placeholder first"
                    )
    return failures


def _queries(value: object) -> list[object]:
    """One query per filter shape, all bound to the same *value*."""

    from hypequery.datasets.planner import DatasetQuery
    from hypequery.datasets.query_helpers import Filter

    return [
        DatasetQuery(
            dimensions=("vendor",),
            filters=(Filter(field="vendor", operator="eq", value=value),),
        ),
        DatasetQuery(
            dimensions=("vendor",),
            filters=(Filter(field="vendor", operator="in", value=[value, value]),),
        ),
        DatasetQuery(
            dimensions=("vendor",),
            filters=(Filter(field="vendor", operator="between", value=[value, value]),),
        ),
        DatasetQuery(
            dimensions=("vendor",),
            filters=(Filter(field="vendor", operator="like", value=value),),
        ),
    ]


def check_behaviour() -> list[str]:
    """Plan hostile queries and report any way a value changed the statement."""

    sys.path.insert(0, str(ROOT / "src"))
    from hypequery.datasets import Dataset, count, dimension, measure
    from hypequery.datasets.planner import ExecutionContext, plan_dataset_query, tenant

    dataset = Dataset(
        name="trips",
        source="analytics.trips",
        time_key="pickup_datetime",
        tenant_key="tenant_id",
        dimensions={
            "vendor": dimension("string"),
            "fare": dimension("number"),
            "pickup": dimension("timestamp", column="pickup_datetime"),
        },
        measures={"trips": measure(count("id"))},
    )

    def plan(value: object, index: int) -> object:
        return plan_dataset_query(
            dataset,
            _queries(value)[index],  # type: ignore[arg-type]
            context=ExecutionContext(tenant=tenant(str(value) or BENIGN)),
        )

    failures: list[str] = []
    for hostile in HOSTILE:
        for index in range(len(_queries(BENIGN))):
            compiled = plan(hostile, index)
            reference = plan(BENIGN, index)
            where = f"shape {index}, value {hostile!r}"
            if compiled.sql != reference.sql:  # type: ignore[attr-defined]
                failures.append(f"{where}: the value changed CompiledQuery.sql")
            if compiled.to_sql() != reference.to_sql():  # type: ignore[attr-defined]
                failures.append(f"{where}: the value changed the debug form")
            bound = list(compiled.parameter_values().values())  # type: ignore[attr-defined]
            flat = [item for value in bound for item in (value if type(value) is list else [value])]
            if hostile not in flat:
                failures.append(f"{where}: was not bound as a parameter either")
            if hostile in SEARCHABLE:
                if hostile in compiled.sql:  # type: ignore[attr-defined]
                    failures.append(f"{where}: appears verbatim in CompiledQuery.sql")
                if hostile in compiled.to_sql():  # type: ignore[attr-defined]
                    failures.append(f"{where}: appears verbatim in the debug form")
    return failures


def main() -> int:
    failures = check_structure() + check_behaviour()
    for failure in failures:
        print(f"error: {failure}", file=sys.stderr)
    if failures:
        print(f"\n{len(failures)} SQL interpolation check failure(s)", file=sys.stderr)
        return 1
    print("SQL interpolation checks passed: no caller value reaches SQL text.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
