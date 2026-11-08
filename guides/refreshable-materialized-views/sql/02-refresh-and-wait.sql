-- The first refresh starts as soon as the view exists. Force one now and
-- block until it finishes, which is what a deploy script or a test wants.
SYSTEM REFRESH VIEW guide_tenant_daily_rmv;
SYSTEM WAIT VIEW guide_tenant_daily_rmv;

-- The target now holds one row per tenant-day.
SELECT count() AS rows, min(day) AS first_day, max(day) AS last_day
FROM guide_tenant_daily;
