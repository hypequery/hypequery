-- Chain views with DEPENDS ON: this daily-by-plan summary waits for the
-- tenant-day refresh to finish before it runs, so it never reads a half-built
-- table. Both still follow their own schedule.
CREATE TABLE IF NOT EXISTS guide_plan_daily
(
    day     Date,
    plan    LowCardinality(String),
    tenants UInt64,
    events  UInt64
)
ENGINE = MergeTree
ORDER BY (plan, day);

CREATE MATERIALIZED VIEW IF NOT EXISTS guide_plan_daily_rmv
REFRESH EVERY 1 HOUR
DEPENDS ON guide_tenant_daily_rmv
TO guide_plan_daily AS
SELECT
    day,
    plan,
    uniqExact(tenant_id) AS tenants,
    sum(events)          AS events
FROM guide_tenant_daily
GROUP BY day, plan;

SYSTEM REFRESH VIEW guide_plan_daily_rmv;
SYSTEM WAIT VIEW guide_plan_daily_rmv;

SELECT plan, sum(events) AS events
FROM guide_plan_daily
GROUP BY plan
ORDER BY events DESC;
