CREATE TABLE IF NOT EXISTS orders
(
    id String,
    country LowCardinality(String),
    status LowCardinality(String),
    amount Decimal(12, 2),
    created_at DateTime64(3, 'UTC')
)
ENGINE = MergeTree
ORDER BY (created_at, id);

INSERT INTO orders VALUES
    ('o1', 'NZ', 'paid', 120.50, '2026-09-01 10:00:00'),
    ('o2', 'NZ', 'paid', 80.00, '2026-09-02 11:30:00'),
    ('o3', 'AU', 'paid', 200.00, '2026-09-02 12:00:00'),
    ('o4', 'AU', 'refunded', 50.00, '2026-09-03 09:15:00'),
    ('o5', 'US', 'paid', 310.25, '2026-09-04 16:45:00');
