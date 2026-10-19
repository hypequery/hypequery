"""Read ClickHouse connection fields from ``CLICKHOUSE_*`` environment variables.

One parser for the CLI, project scaffolds, and examples, so they agree on names,
defaults, and what counts as a valid value. A malformed value is an error that
names the variable and never echoes it: a misplaced secret must not reach a log.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import TypedDict

#: The variables read, and their defaults when unset or empty.
ENVIRONMENT_DEFAULTS: Mapping[str, str] = {
    "CLICKHOUSE_HOST": "localhost",
    "CLICKHOUSE_DATABASE": "default",
    "CLICKHOUSE_USERNAME": "default",
    "CLICKHOUSE_PASSWORD": "",
}

_TRUE = frozenset(("1", "true", "yes", "on"))
_FALSE = frozenset(("0", "false", "no", "off"))


class ConnectionFields(TypedDict):
    host: str
    port: int | None
    database: str
    username: str
    password: str
    secure: bool


def _text(environ: Mapping[str, str], name: str) -> str:
    return environ.get(name) or ENVIRONMENT_DEFAULTS[name]


def _port(environ: Mapping[str, str]) -> int | None:
    raw = environ.get("CLICKHOUSE_PORT", "").strip()
    if not raw:
        # The driver picks 8123 for HTTP and 8443 for HTTPS.
        return None
    if not raw.isascii() or not raw.isdigit() or not 1 <= int(raw) <= 65535:
        raise ValueError("CLICKHOUSE_PORT must be an integer between 1 and 65535")
    return int(raw)


def _secure(environ: Mapping[str, str]) -> bool:
    raw = environ.get("CLICKHOUSE_SECURE", "").strip().lower()
    if not raw or raw in _FALSE:
        return False
    if raw in _TRUE:
        return True
    raise ValueError("CLICKHOUSE_SECURE must be true or false")


def connection_fields(environ: Mapping[str, str]) -> ConnectionFields:
    """Validated connection fields from *environ*."""

    return {
        "host": _text(environ, "CLICKHOUSE_HOST"),
        "port": _port(environ),
        "database": _text(environ, "CLICKHOUSE_DATABASE"),
        "username": _text(environ, "CLICKHOUSE_USERNAME"),
        "password": _text(environ, "CLICKHOUSE_PASSWORD"),
        "secure": _secure(environ),
    }
