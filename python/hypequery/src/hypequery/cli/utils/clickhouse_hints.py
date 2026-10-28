"""Name the setting to check when ClickHouse refuses the CLI or a dev app.

Keyed by the executor's safe failure codes and categories, so a message names
environment variables and never repeats the driver's text, which may hold URLs
or values.
"""

from __future__ import annotations

from hypequery.datasets.planner import CompiledQueryError

_CODE_HINTS = {
    "HQ_EXECUTOR_CREDENTIALS_REJECTED": (
        "ClickHouse rejected the credentials; check CLICKHOUSE_USERNAME and CLICKHOUSE_PASSWORD."
    ),
    "HQ_EXECUTOR_DATABASE_MISSING": "ClickHouse database not found; check CLICKHOUSE_DATABASE.",
    "HQ_EXECUTOR_ACCESS_DENIED": (
        "ClickHouse denied access; check the user's grants and readonly profile."
    ),
    "HQ_EXECUTOR_READONLY_MISCONFIGURED": (
        "ClickHouse refused HypeQuery's readonly settings; check the user's readonly profile "
        "and readonly_policy."
    ),
}

_CATEGORY_HINTS = {
    "unavailable": (
        "ClickHouse is unreachable; check CLICKHOUSE_HOST, CLICKHOUSE_PORT and CLICKHOUSE_SECURE."
    ),
}

_FALLBACK = "ClickHouse refused the connection; check the CLICKHOUSE_* environment."


def clickhouse_hint(error: CompiledQueryError) -> str:
    if error.code is not None and error.code in _CODE_HINTS:
        return _CODE_HINTS[error.code]
    return _CATEGORY_HINTS.get(error.category, _FALLBACK)
