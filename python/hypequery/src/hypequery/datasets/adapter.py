"""RFC 0012 NDJSON adapter for the ``sql-portability-v1`` fixture family.

The SQL portability compiler lives in ``hypequery.datasets``, so its adapter
lives here rather than beside the protocol adapter — the protocol layer must
not depend on datasets. The runner invokes one adapter at a time; this one
announces only ``sql-portability-v1``.
"""

from __future__ import annotations

from hypequery import __version__
from hypequery.protocol import expression_to_data
from hypequery.protocol.stdio_adapter import run_stdio_adapter

from .sql_portability import compile_portable_sql_expression

FAMILIES = ("sql-portability-v1",)


def _sql_for_case(case: dict[str, object]) -> str:
    """Read a case's SQL, materializing the compact repeat form when used."""

    sql = case.get("sql")
    if type(sql) is str:
        return sql
    spec = case.get("sqlRepeat")
    if type(spec) is not dict:
        raise RuntimeError("sql-portability case has no sql source")
    prefix = spec.get("prefix", "")
    value = spec.get("value", "")
    suffix = spec.get("suffix", "")
    count = spec.get("count", 0)
    if type(prefix) is not str or type(value) is not str or type(suffix) is not str:
        raise RuntimeError("sqlRepeat fields must be strings")
    if type(count) is not int:
        raise RuntimeError("sqlRepeat count must be an integer")
    return f"{prefix}{value * count}{suffix}"


def _handle(
    _family: str, role: str, case: dict[str, object], _section: object
) -> dict[str, object]:
    result = compile_portable_sql_expression(_sql_for_case(case))
    if result.portable:
        if role in ("portable", "fuzz"):
            return {
                "ok": True,
                "output": {
                    "expression": expression_to_data(result.expression),
                    "dependencies": list(result.dependencies),
                },
            }
        return {"ok": True}
    issue = result.issues[0]
    return {"ok": False, "code": issue.code, "output": {"start": issue.start}}


def main() -> int:
    """Run the adapter loop until the conformance runner sends ``end``."""

    return run_stdio_adapter(
        implementation="hypequery",
        version=__version__,
        language="python",
        families=FAMILIES,
        handle=_handle,
    )


if __name__ == "__main__":
    raise SystemExit(main())
