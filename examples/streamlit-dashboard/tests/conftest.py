"""Ground truth for the tests: raw SQL straight through clickhouse_connect."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest
from clickhouse_connect import get_client

from analytics.connection import connection_from_env

PERIOD = ("2026-10-01 00:00:00", "2026-10-31 23:59:59")  # the dashboard's default period


@pytest.fixture(scope="session")
def raw() -> Callable[..., list[tuple[Any, ...]]]:
    c = connection_from_env()
    ch = get_client(host=c.host, port=c.port, username=c.username, password=c.password,
                    database=c.database, secure=c.secure)

    def run(sql: str, **parameters: Any) -> list[tuple[Any, ...]]:
        where = "occurred_at BETWEEN {a:String} AND {b:String}"
        return ch.query(sql.replace("$PERIOD", where), parameters={"a": PERIOD[0], "b": PERIOD[1], **parameters}).result_rows

    return run
