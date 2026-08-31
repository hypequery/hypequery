CREATE DATABASE IF NOT EXISTS analytics;

DROP TABLE IF EXISTS analytics.orders;

CREATE TABLE analytics.orders
(
  tenant_id String,
  order_id UInt64,
  status LowCardinality(String),
  region LowCardinality(String),
  amount Decimal(12, 2),
  created_at DateTime64(3, 'UTC')
)
ENGINE = MergeTree
ORDER BY (tenant_id, created_at, order_id);

INSERT INTO analytics.orders VALUES
  ('tenant_acme', 1, 'completed', 'eu', 100.00, '2026-08-01 10:00:00.000'),
  ('tenant_acme', 2, 'completed', 'us', 50.00, '2026-08-02 11:00:00.000'),
  ('tenant_acme', 3, 'cancelled', 'eu', 25.00, '2026-08-03 12:00:00.000'),
  ('tenant_globex', 4, 'completed', 'eu', 1000.00, '2026-08-04 13:00:00.000');
