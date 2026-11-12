-- Your own table next to the sample data. Dropped first so the file can be
-- re-run; the last file drops it again.
DROP TABLE IF EXISTS clickhouse_docker_compose_page_views;

CREATE TABLE clickhouse_docker_compose_page_views
(
    viewed_at  DateTime('UTC'),
    tenant_id  UInt32,
    path       LowCardinality(String),
    latency_ms UInt32
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(viewed_at)
ORDER BY (tenant_id, viewed_at);

-- Insert rows by hand...
INSERT INTO clickhouse_docker_compose_page_views VALUES
    ('2026-11-01 09:00:00', 1, '/dashboard', 120),
    ('2026-11-01 09:00:05', 1, '/reports', 340);

-- ...or from a query: October's page views from the sample events.
INSERT INTO clickhouse_docker_compose_page_views
SELECT occurred_at, tenant_id, path, latency_ms
FROM events
WHERE event_type = 'page_view'
  AND occurred_at >= '2026-10-01 00:00:00' AND occurred_at < '2026-11-01 00:00:00';

SELECT
    path,
    count()                    AS views,
    quantile(0.95)(latency_ms) AS p95_latency_ms
FROM clickhouse_docker_compose_page_views
GROUP BY path
ORDER BY views DESC
LIMIT 5;
