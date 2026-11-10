-- Where CDC from Postgres lands (PeerDB, ClickPipes, Debezium): a
-- ReplacingMergeTree keyed like the Postgres primary key. Every change
-- arrives as a new row with a higher version; deletes arrive with
-- _is_deleted = 1. Merges keep the latest version in the background.
DROP TABLE IF EXISTS clickhouse_vs_postgres_app_analytics_subscriptions;

CREATE TABLE clickhouse_vs_postgres_app_analytics_subscriptions
(
    subscription_id UInt32,
    tenant_id       UInt32,
    plan            LowCardinality(String),
    status          LowCardinality(String),
    amount          Decimal(12, 2),
    _version        UInt64,
    _is_deleted     UInt8
)
ENGINE = ReplacingMergeTree(_version, _is_deleted)
ORDER BY subscription_id;

-- The initial snapshot: the seed's subscriptions, version 1.
INSERT INTO clickhouse_vs_postgres_app_analytics_subscriptions
SELECT subscription_id, tenant_id, plan, status, amount, 1, 0
FROM subscriptions;

-- Later changes: subscription 1 is upgraded (UPDATE), subscription 2 is
-- removed (DELETE). Each is an insert, never an in-place update.
INSERT INTO clickhouse_vs_postgres_app_analytics_subscriptions
SELECT subscription_id, tenant_id, 'enterprise', 'active', amount * 3, 2, 0
FROM subscriptions WHERE subscription_id = 1;

INSERT INTO clickhouse_vs_postgres_app_analytics_subscriptions
SELECT subscription_id, tenant_id, plan, status, amount, 2, 1
FROM subscriptions WHERE subscription_id = 2;

-- Without FINAL you can see every version that has not been merged yet:
-- four rows for two subscriptions (both versions of each).
SELECT subscription_id, plan, status, _version, _is_deleted
FROM clickhouse_vs_postgres_app_analytics_subscriptions
WHERE subscription_id IN (1, 2)
ORDER BY subscription_id, _version;

-- FINAL returns the current state: subscription 1 upgraded, 2 gone, and the
-- row count back to one per live subscription.
SELECT subscription_id, plan, status, _version
FROM clickhouse_vs_postgres_app_analytics_subscriptions FINAL
WHERE subscription_id IN (1, 2)
ORDER BY subscription_id;

SELECT
    (SELECT count() FROM subscriptions)                                              AS source_rows,
    (SELECT count() FROM clickhouse_vs_postgres_app_analytics_subscriptions)         AS stored_rows,
    (SELECT count() FROM clickhouse_vs_postgres_app_analytics_subscriptions FINAL)   AS current_rows;

-- Clean up so the file can run again from scratch.
DROP TABLE IF EXISTS clickhouse_vs_postgres_app_analytics_subscriptions;
