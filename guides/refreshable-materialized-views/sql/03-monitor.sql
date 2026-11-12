-- Every refreshable view reports here: current status, last success, the
-- next scheduled run, and the exception if the last refresh failed.
SELECT
    database,
    view,
    status,
    last_success_time,
    last_refresh_time,
    next_refresh_time,
    exception,
    retry,
    progress,
    read_rows,
    total_rows
FROM system.view_refreshes
WHERE view = 'guide_tenant_daily_rmv';
