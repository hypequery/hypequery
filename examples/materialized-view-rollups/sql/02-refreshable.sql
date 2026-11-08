-- Refreshable materialized view: a scheduled full recompute.
--
-- The whole query re-runs every hour and atomically replaces the target. That
-- makes JOINs and exact percentiles easy, at the cost of freshness: rows are
-- up to one hour old. Available without flags since ClickHouse 24.10.

CREATE TABLE IF NOT EXISTS tenant_daily_summary
(
    day              Date,
    tenant_id        UInt32,
    tenant_name      String,
    plan             LowCardinality(String),
    events           UInt64,
    errors           UInt64,
    unique_users     UInt64,
    p95_latency_ms   UInt32
)
ENGINE = MergeTree
ORDER BY (tenant_id, day);

CREATE MATERIALIZED VIEW IF NOT EXISTS tenant_daily_summary_rmv
REFRESH EVERY 1 HOUR
TO tenant_daily_summary AS
SELECT
    toDate(e.occurred_at)                       AS day,
    e.tenant_id,
    t.name                                      AS tenant_name,
    t.plan,
    count()                                     AS events,
    countIf(e.status_code >= 500)               AS errors,
    uniqExact(e.user_id)                        AS unique_users,
    toUInt32(quantileExact(0.95)(e.latency_ms)) AS p95_latency_ms
FROM events AS e
INNER JOIN tenants AS t ON t.tenant_id = e.tenant_id
GROUP BY day, e.tenant_id, t.name, t.plan;
