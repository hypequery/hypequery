-- Change the schedule in place; the next run follows the new interval.
ALTER TABLE guide_tenant_daily_rmv MODIFY REFRESH EVERY 6 HOUR;

-- DEPENDS ON is kept (or changed) in the same statement. It only works with
-- REFRESH EVERY, never with REFRESH AFTER.
ALTER TABLE guide_plan_daily_rmv MODIFY REFRESH EVERY 6 HOUR DEPENDS ON guide_tenant_daily_rmv;

-- REFRESH AFTER re-runs an interval after the previous run finished, rather
-- than on the wall clock. An APPEND view must say APPEND again: adding or
-- removing APPEND is not allowed once the view exists.
ALTER TABLE guide_active_tenants_rmv MODIFY REFRESH AFTER 30 MINUTE RANDOMIZE FOR 5 MINUTE APPEND;

SELECT view, status, last_success_time, last_success_duration_ms, next_refresh_time
FROM system.view_refreshes
WHERE view IN ('guide_tenant_daily_rmv', 'guide_plan_daily_rmv', 'guide_active_tenants_rmv')
ORDER BY view;

-- Dropping a refreshable view leaves its target table and rows in place.
DROP VIEW IF EXISTS guide_active_tenants_rmv;
DROP VIEW IF EXISTS guide_plan_daily_rmv;
DROP VIEW IF EXISTS guide_tenant_daily_rmv;
SELECT count() AS rows_kept FROM guide_tenant_daily;

-- Clean up so the files can run again from scratch.
DROP TABLE IF EXISTS guide_active_tenants_snapshots;
DROP TABLE IF EXISTS guide_plan_daily;
DROP TABLE IF EXISTS guide_tenant_daily;
