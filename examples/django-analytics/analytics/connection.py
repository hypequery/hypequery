"""One ClickHouse URL from the CLICKHOUSE_* variables every example in this
repository shares (URL + username + password + database).

hypequery's own `ClickHouseConnection.from_env()` treats CLICKHOUSE_URL and the
field variables as alternatives, so the settings pass it a single URL instead.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from urllib.parse import quote, urlsplit


def clickhouse_url(environ: Mapping[str, str] | None = None) -> str:
    env = os.environ if environ is None else environ
    url = urlsplit(env.get("CLICKHOUSE_URL", "http://localhost:8123"))
    scheme = "https" if url.scheme == "https" else "http"
    host = url.hostname or "localhost"
    port = url.port or (8443 if scheme == "https" else 8123)
    user = env.get("CLICKHOUSE_USERNAME", url.username or "default")
    password = env.get("CLICKHOUSE_PASSWORD", url.password or "hypequery")
    database = env.get("CLICKHOUSE_DATABASE", url.path.strip("/") or "hypequery_examples")
    return f"{scheme}://{quote(user, safe='')}:{quote(password, safe='')}@{host}:{port}/{quote(database, safe='')}"
