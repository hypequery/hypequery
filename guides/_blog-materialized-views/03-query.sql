-- Query the target with -Merge functions and a GROUP BY: parts may hold
-- several partial rows per key until a background merge combines them.
SELECT
    day,
    sum(events)              AS events,
    uniqMerge(unique_users)  AS unique_users
FROM blog_events_daily
WHERE day BETWEEN '2026-10-25' AND '2026-10-31'
GROUP BY day
ORDER BY day;
