-- Create a materialized view the production way: an explicit target table
-- you own, then the view writing TO it. Aggregate states keep uniques correct
-- across merges and across grains.
CREATE TABLE IF NOT EXISTS blog_events_daily
(
    day          Date,
    tenant_id    UInt32,
    events       SimpleAggregateFunction(sum, UInt64),
    unique_users AggregateFunction(uniq, UInt32)
)
ENGINE = AggregatingMergeTree
ORDER BY (tenant_id, day);

CREATE MATERIALIZED VIEW IF NOT EXISTS blog_events_daily_mv TO blog_events_daily AS
SELECT
    toDate(occurred_at) AS day,
    tenant_id,
    count()             AS events,
    uniqState(user_id)  AS unique_users
FROM events
GROUP BY day, tenant_id;
