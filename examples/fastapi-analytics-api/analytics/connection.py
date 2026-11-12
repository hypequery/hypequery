"""Build the ClickHouse connection from the CLICKHOUSE_* variables every
example in this repository shares (URL + username + password + database)."""

from __future__ import annotations

import os
from urllib.parse import urlsplit

from hypequery.execution import ClickHouseConnection


def connection_from_env(environ: dict[str, str] | None = None) -> ClickHouseConnection:
    env = os.environ if environ is None else environ
    url = urlsplit(env.get("CLICKHOUSE_URL", "http://localhost:8123"))
    return ClickHouseConnection(
        host=url.hostname or "localhost",
        port=url.port or (8443 if url.scheme == "https" else 8123),
        secure=url.scheme == "https",
        database=env.get("CLICKHOUSE_DATABASE", "hypequery_examples"),
        username=env.get("CLICKHOUSE_USERNAME", url.username or "default"),
        password=env.get("CLICKHOUSE_PASSWORD", url.password or "hypequery"),
    )
