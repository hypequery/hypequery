-- Run against your example database using clickhouse-client --multiquery.
-- Idempotent seed. Real applications own their schema and migrations.
CREATE TABLE IF NOT EXISTS example_orders (
    id UInt64,
    org_id String,
    country String,
    created_at DateTime('UTC'),
    amount Float64
) ENGINE = MergeTree ORDER BY (org_id, id);
INSERT INTO example_orders
SELECT * FROM values(
    'id UInt64, org_id String, country String, created_at DateTime, amount Float64',
    (1, 'a', 'US', '2026-01-01 12:00:00', 10),
    (2, 'a', 'DE', '2026-01-02 12:00:00', 20),
    (3, 'b', 'US', '2026-01-01 12:00:00', 90)
) WHERE (org_id, id) NOT IN (SELECT org_id, id FROM example_orders);
