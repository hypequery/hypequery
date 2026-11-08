-- APPEND keeps history instead of replacing the table: each refresh inserts
-- its rows. Use it for snapshots ("how many active tenants did we have each
-- hour"), and pair it with a TTL or a partition key you can drop.
CREATE TABLE IF NOT EXISTS guide_active_tenants_snapshots
(
    taken_at       DateTime('UTC'),
    active_tenants UInt64,
    events_last_7d UInt64
)
ENGINE = MergeTree
ORDER BY taken_at
TTL taken_at + INTERVAL 90 DAY;

-- RANDOMIZE FOR spreads refreshes so many views do not all start on the hour.
CREATE MATERIALIZED VIEW IF NOT EXISTS guide_active_tenants_rmv
REFRESH EVERY 1 HOUR RANDOMIZE FOR 10 MINUTE
APPEND TO guide_active_tenants_snapshots AS
SELECT
    now()                                                                  AS taken_at,
    uniqExact(tenant_id)                                                   AS active_tenants,
    countIf(occurred_at >= toDateTime('2026-10-31 23:59:59') - INTERVAL 7 DAY) AS events_last_7d
FROM events;

SYSTEM REFRESH VIEW guide_active_tenants_rmv;
SYSTEM WAIT VIEW guide_active_tenants_rmv;

SELECT count() AS snapshots, max(active_tenants) AS active_tenants
FROM guide_active_tenants_snapshots;
