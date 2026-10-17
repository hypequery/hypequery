-- Run only in your tutorial database using clickhouse-client --multiquery.
CREATE TABLE IF NOT EXISTS client_orders (
    id UInt64,
    org_id String,
    country Nullable(String),
    created_at DateTime('UTC'),
    amount Decimal(18, 2)
) ENGINE = MergeTree ORDER BY (org_id, id);
INSERT INTO client_orders
SELECT * FROM values(
    'id UInt64, org_id String, country Nullable(String), created_at DateTime, amount Decimal(18, 2)',
    (1, 'a', 'US', '2026-01-01 12:00:00', 10.00),
    (2, 'a', 'DE', '2026-01-02 12:00:00', 20.00),
    (3, 'a', NULL, '2026-01-03 12:00:00', 30.00),
    (4, 'b', 'CA', '2026-01-01 12:00:00', 100.00),
    (5, 'b', 'UK', '2026-01-02 12:00:00', 900.00)
) WHERE (org_id, id) NOT IN (SELECT org_id, id FROM client_orders);
