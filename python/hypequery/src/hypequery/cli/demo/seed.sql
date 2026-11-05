-- The `hypequery demo` sample data: a shop with two tenants, acme and globex,
-- from 2026-07-01 to 2026-09-30. Every value is derived from numbers(), so
-- the data, and every answer the demo prints, is the same on every run.
-- Statements are separated by a semicolon at the end of a line.

-- Orders arrive as change data capture: each update is a new row version, and
-- a deleted order is a final version with is_deleted = 1. Until a background
-- merge runs, which may be never, a plain read sees every version.
CREATE TABLE orders
(
    tenant_id LowCardinality(String),
    order_id String,
    customer_id String,
    country LowCardinality(String),
    status LowCardinality(String),
    amount Decimal(12, 2),
    created_at DateTime('UTC'),
    version UInt32,
    is_deleted UInt8
)
ENGINE = ReplacingMergeTree(version, is_deleted)
ORDER BY (tenant_id, order_id);

-- Keep the versions apart, as they are on a busy server between merges.
SYSTEM STOP MERGES orders;

-- Version 1: 2,400 orders placed, pending payment. Order volume and basket
-- size both grow month over month.
INSERT INTO orders
SELECT
    if(number % 3 = 0, 'globex', 'acme'),
    concat('o', leftPad(toString(number), 5, '0')),
    concat('c', toString(cityHash64(number, 'customer') % 420)),
    ['US', 'GB', 'DE', 'NZ', 'AU'][cityHash64(number, 'country') % 5 + 1],
    'pending',
    toDecimal64(20 + (cityHash64(number, 'amount') % 6000) / 100 + number / 40, 2),
    toDateTime('2026-07-01 00:00:00', 'UTC') + toIntervalSecond(intDiv(pow(number / 2400, 0.8) * 7948800, 1)),
    1,
    0
FROM numbers(2400);

-- Version 2: three in four orders are paid.
INSERT INTO orders
SELECT tenant_id, order_id, customer_id, country, 'paid', amount, created_at, 2, 0
FROM orders
WHERE toUInt32(substring(order_id, 2)) % 4 != 3;

-- Version 3: one order in 25 was a test order, and is deleted.
INSERT INTO orders
SELECT tenant_id, order_id, customer_id, country, status, amount, created_at, 3, 1
FROM orders FINAL
WHERE toUInt32(substring(order_id, 2)) % 25 = 0;

-- Product events: 400,000 of them, from about 150,000 users.
CREATE TABLE events
(
    tenant_id LowCardinality(String),
    user_id String,
    event LowCardinality(String),
    event_time DateTime('UTC')
)
ENGINE = MergeTree
ORDER BY (tenant_id, event_time);

-- Daily aggregate states, maintained by a materialized view as events arrive.
-- A state column holds a partial aggregate: it must be finished with -Merge.
CREATE TABLE daily_activity
(
    tenant_id LowCardinality(String),
    day Date,
    users_state AggregateFunction(uniq, String),
    events_state AggregateFunction(count)
)
ENGINE = AggregatingMergeTree
ORDER BY (tenant_id, day);

CREATE MATERIALIZED VIEW daily_activity_mv TO daily_activity AS
SELECT
    tenant_id,
    toDate(event_time) AS day,
    uniqState(user_id) AS users_state,
    countState() AS events_state
FROM events
GROUP BY tenant_id, day;

INSERT INTO events
SELECT
    if(cityHash64(number, 'tenant') % 3 = 0, 'globex', 'acme'),
    concat('u', toString(cityHash64(number, 'user') % 150000)),
    ['page_view', 'page_view', 'search', 'add_to_cart', 'checkout'][cityHash64(number, 'event') % 5 + 1],
    toDateTime('2026-07-01 00:00:00', 'UTC') + toIntervalSecond(cityHash64(number, 'time') % 7948800)
FROM numbers(400000);
