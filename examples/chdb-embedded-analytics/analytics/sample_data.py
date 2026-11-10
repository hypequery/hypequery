"""A small, deterministic copy of the seed's `tenants` and `events` tables,
generated inside chDB from numbers() and cityHash64, so every run on every
machine produces the same rows and the tests can pin the numbers.

The columns match examples/_seed/schema.sql, which is why the datasets in
datasets.py run unchanged against the shared seed on a ClickHouse server.
"""

from __future__ import annotations

from typing import Any

import chdb

TENANT_ROWS = 24
EVENT_ROWS = 200_000

SCHEMA = (
    """
    CREATE TABLE IF NOT EXISTS tenants
    (
        tenant_id UInt32, name String, plan LowCardinality(String),
        region LowCardinality(String), industry LowCardinality(String), created_at DateTime('UTC')
    )
    ENGINE = MergeTree ORDER BY tenant_id
    """,
    """
    CREATE TABLE IF NOT EXISTS events
    (
        event_id UInt64, tenant_id UInt32, user_id UInt32, event_type LowCardinality(String),
        path String, status_code UInt16, latency_ms UInt32, device LowCardinality(String),
        occurred_at DateTime('UTC')
    )
    ENGINE = MergeTree PARTITION BY toYYYYMM(occurred_at) ORDER BY (tenant_id, occurred_at, event_id)
    """,
)

TENANTS = f"""
INSERT INTO tenants
SELECT
    toUInt32(number + 1),
    concat('Tenant ', toString(number + 1)),
    ['enterprise', 'growth', 'starter', 'free'][number % 4 + 1],
    ['us-east', 'us-west', 'eu-west', 'ap-south'][intDiv(number, 4) % 4 + 1],
    ['saas', 'fintech', 'retail', 'media', 'health', 'logistics'][number % 6 + 1],
    toDateTime('2025-01-01 00:00:00', 'UTC') + toIntervalDay(number * 7)
FROM numbers({TENANT_ROWS})
"""

# Integer arithmetic only, so the rows are identical on every platform. Low
# tenant ids get more traffic; ~8% of requests take a long-tail latency hit.
EVENTS = f"""
INSERT INTO events
SELECT
    number + 1 AS event_id,
    toUInt32(1 + intDiv((cityHash64(number, 1) % 300) * (cityHash64(number, 1) % 300), 3750)) AS tenant_id,
    toUInt32(tenant_id * 1000 + cityHash64(number, 2) % (40 + tenant_id * 37 % 160) + 1) AS user_id,
    multiIf(r < 45, 'page_view', r < 70, 'api_call', r < 83, 'query_run',
            r < 91, 'login', r < 95, 'export', 'error') AS event_type,
    ['/dashboard', '/explore', '/reports', '/settings', '/api/query', '/api/export'][cityHash64(number, 4) % 6 + 1],
    toUInt16(multiIf(event_type = 'error', [500, 502, 503, 404][cityHash64(number, 5) % 4 + 1],
                     cityHash64(number, 5) % 100 < 2, 500, 200)),
    toUInt32(20 + cityHash64(number, 6) % 180
             + if(cityHash64(number, 7) % 100 < 8, cityHash64(number, 8) % 4000, 0)),
    if(event_type = 'api_call', 'api', ['desktop', 'mobile', 'tablet'][cityHash64(number, 9) % 3 + 1]),
    toDateTime('2025-11-01 00:00:00', 'UTC') + toIntervalSecond(cityHash64(number, 10) % 31536000)
FROM (SELECT number, cityHash64(number, 3) % 100 AS r FROM numbers({EVENT_ROWS}))
"""


def _count(connection: Any, table: str) -> int:
    return int(connection.query(f"SELECT count() FROM {table}", "CSV").bytes().decode().strip())


def ensure_sample_data(path: str) -> None:
    """Create and fill the tables at *path* unless a previous run already did.

    Call it before opening an executor on *path*: the executor is read-only.
    """

    connection = chdb.connect(path)
    try:
        for statement in SCHEMA:
            connection.query(statement)
        for table, rows, insert in (("tenants", TENANT_ROWS, TENANTS), ("events", EVENT_ROWS, EVENTS)):
            if _count(connection, table) != rows:
                connection.query(f"TRUNCATE TABLE {table}")
                connection.query(insert)
    finally:
        connection.close()
