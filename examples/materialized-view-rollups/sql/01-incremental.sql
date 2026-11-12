-- Incremental materialized view: an INSERT trigger on `events`.
--
-- Every block inserted into `events` is aggregated and appended to
-- `events_daily`. The target keeps aggregate *states*, so uniques stay correct
-- when ClickHouse merges parts or when a query rolls days up into weeks.

CREATE TABLE IF NOT EXISTS events_daily
(
    day         Date,
    tenant_id   UInt32,
    event_type  LowCardinality(String),
    -- plain additive numbers can use SimpleAggregateFunction
    events      SimpleAggregateFunction(sum, UInt64),
    errors      SimpleAggregateFunction(sum, UInt64),
    -- distinct counts need a real aggregate state
    users       AggregateFunction(uniqExact, UInt32)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(day)
ORDER BY (tenant_id, day, event_type);

-- `TO events_daily` keeps the target an ordinary table you own; no POPULATE,
-- because POPULATE skips rows inserted while the view is being built.
CREATE MATERIALIZED VIEW IF NOT EXISTS events_daily_mv TO events_daily AS
SELECT
    toDate(occurred_at)                 AS day,
    tenant_id,
    event_type,
    count()                             AS events,
    countIf(status_code >= 500)         AS errors,
    uniqExactState(user_id)             AS users
FROM events
GROUP BY day, tenant_id, event_type;

-- Backfill history with the same SELECT, straight into the target. The view
-- only sees inserts that happen after it exists.
TRUNCATE TABLE events_daily;

INSERT INTO events_daily
SELECT
    toDate(occurred_at)                 AS day,
    tenant_id,
    event_type,
    count()                             AS events,
    countIf(status_code >= 500)         AS errors,
    uniqExactState(user_id)             AS users
FROM events
GROUP BY day, tenant_id, event_type;
