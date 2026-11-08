-- Change a view's SELECT without touching the target or its data.
-- There is no CREATE OR REPLACE MATERIALIZED VIEW in ClickHouse (it is a
-- syntax error); use ALTER TABLE ... MODIFY QUERY, or DROP and CREATE again,
-- which is safe because the data lives in the TO table.
ALTER TABLE blog_events_daily_mv MODIFY QUERY
SELECT
    toDate(occurred_at) AS day,
    tenant_id,
    count()             AS events,
    uniqState(user_id)  AS unique_users
FROM events
WHERE event_type != 'error'
GROUP BY day, tenant_id;

SHOW CREATE TABLE blog_events_daily_mv;

-- Drop the view; the target table and its rows stay.
DROP VIEW IF EXISTS blog_events_daily_mv;
SELECT count() AS rows_kept FROM blog_events_daily;

-- Clean up so the file can run again from scratch.
DROP TABLE IF EXISTS blog_events_daily;
