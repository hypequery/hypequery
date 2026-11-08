-- Backfill history with INSERT ... SELECT straight into the target. Never
-- POPULATE: it blocks, and rows inserted while it runs are lost.
INSERT INTO blog_events_daily
SELECT
    toDate(occurred_at) AS day,
    tenant_id,
    count()             AS events,
    uniqState(user_id)  AS unique_users
FROM events
GROUP BY day, tenant_id;
