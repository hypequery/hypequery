-- ClickHouse is columnar: a query reads only the columns it names. This one
-- touches event_type and latency_ms, about 5 MB of the table's 45 MB.
SELECT event_type, avg(latency_ms) AS avg_latency_ms
FROM events
GROUP BY event_type;

-- The other side: a lookup Postgres answers from a B-tree index in well
-- under a millisecond. ClickHouse's sparse primary index (ORDER BY tenant_id,
-- occurred_at) skips to the right granules but reads whole granules of 8,192
-- rows: on the merged seed, 2 granules (16,384 rows) to find 36 matches.
SELECT toDate(occurred_at) AS day, count() AS events
FROM events
WHERE tenant_id = 42 AND occurred_at >= '2026-10-01 00:00:00' AND occurred_at < '2026-11-01 00:00:00'
GROUP BY day
ORDER BY day;

EXPLAIN indexes = 1
SELECT count()
FROM events
WHERE tenant_id = 42 AND occurred_at >= '2026-10-01 00:00:00' AND occurred_at < '2026-11-01 00:00:00';
