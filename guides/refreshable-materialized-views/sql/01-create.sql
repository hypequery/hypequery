-- A refreshable materialized view re-runs its whole SELECT on a schedule and
-- atomically replaces the target table. Create the target yourself (TO), so
-- you own its engine, ORDER BY and TTL.
CREATE TABLE IF NOT EXISTS guide_tenant_daily
(
    day             Date,
    tenant_id       UInt32,
    tenant_name     String,
    plan            LowCardinality(String),
    events          UInt64,
    unique_users    UInt64,
    p95_latency_ms  UInt32
)
ENGINE = MergeTree
ORDER BY (tenant_id, day);

-- The JOIN and the exact percentile are what incremental views cannot do
-- cheaply; a scheduled full recompute makes them ordinary SQL.
CREATE MATERIALIZED VIEW IF NOT EXISTS guide_tenant_daily_rmv
REFRESH EVERY 1 HOUR
TO guide_tenant_daily AS
SELECT
    toDate(e.occurred_at)                       AS day,
    e.tenant_id,
    t.name                                      AS tenant_name,
    t.plan,
    count()                                     AS events,
    uniqExact(e.user_id)                        AS unique_users,
    toUInt32(quantileExact(0.95)(e.latency_ms)) AS p95_latency_ms
FROM events AS e
INNER JOIN tenants AS t ON t.tenant_id = e.tenant_id
GROUP BY day, e.tenant_id, t.name, t.plan;
