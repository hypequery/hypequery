"""Name the setting to check when ClickHouse refuses the CLI or a dev app.

Keyed by the executor's safe error categories, so a message names environment
variables and never repeats the driver's text, which may hold URLs or values.
"""

from __future__ import annotations

_HINTS = {
    "unauthenticated": (
        "ClickHouse rejected the credentials; check CLICKHOUSE_USERNAME and CLICKHOUSE_PASSWORD."
    ),
    "unavailable": (
        "ClickHouse is unreachable; check CLICKHOUSE_HOST, CLICKHOUSE_PORT and CLICKHOUSE_SECURE."
    ),
    "not-found": "ClickHouse database not found; check CLICKHOUSE_DATABASE.",
    "forbidden": "ClickHouse denied access; check the user's grants and readonly profile.",
}

_FALLBACK = "ClickHouse refused the connection; check the CLICKHOUSE_* environment."


def clickhouse_hint(category: str) -> str:
    return _HINTS.get(category, _FALLBACK)
