-- A private copy of the seed's events table, so adding projections never
-- touches the shared seed. Same columns, same sorting key:
-- ORDER BY (tenant_id, occurred_at, event_id).
DROP TABLE IF EXISTS projection_for_dataset_queries_events;

CREATE TABLE projection_for_dataset_queries_events AS events
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, occurred_at, event_id);

INSERT INTO projection_for_dataset_queries_events SELECT * FROM events;

-- 1. A normal projection: the same rows, stored a second time sorted by
--    user_id, so "everything for one user" reads a few granules instead of
--    every part.
ALTER TABLE projection_for_dataset_queries_events
    ADD PROJECTION by_user (SELECT * ORDER BY user_id, occurred_at);

-- 2. An aggregate projection: one pre-aggregated row per (day, event_type)
--    per part. Queries that group by those keys, or a subset of them, and
--    filter only on them read this instead of the raw rows.
ALTER TABLE projection_for_dataset_queries_events
    ADD PROJECTION daily_by_type
    (
        SELECT toDate(occurred_at), event_type, count(), sum(latency_ms)
        GROUP BY toDate(occurred_at), event_type
    );

-- ADD PROJECTION only applies to parts written from now on. Existing parts
-- need a MATERIALIZE (a mutation); mutations_sync = 1 waits for it.
ALTER TABLE projection_for_dataset_queries_events
    MATERIALIZE PROJECTION by_user SETTINGS mutations_sync = 1;

ALTER TABLE projection_for_dataset_queries_events
    MATERIALIZE PROJECTION daily_by_type SETTINGS mutations_sync = 1;
