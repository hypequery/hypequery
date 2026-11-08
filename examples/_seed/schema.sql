-- hypequery examples seed: a small multi-tenant SaaS.
--
-- Every example, recipe and guide runs against these four tables so numbers,
-- screenshots and expected SQL stay consistent. Rows are generated
-- deterministically by src/generator.ts; checksums.json pins the result.
--
-- All timestamps are UTC. Event timestamps span 12 months,
-- 2025-11-01 to 2026-10-31.

CREATE TABLE IF NOT EXISTS tenants
(
    tenant_id   UInt32,
    name        String,
    -- free | starter | growth | enterprise
    plan        LowCardinality(String),
    -- us-east | us-west | eu-west | ap-south
    region      LowCardinality(String),
    industry    LowCardinality(String),
    created_at  DateTime('UTC')
)
ENGINE = MergeTree
ORDER BY tenant_id;

CREATE TABLE IF NOT EXISTS users
(
    user_id       UInt32,
    tenant_id     UInt32,
    email         String,
    -- admin | member | viewer
    role          LowCardinality(String),
    country       LowCardinality(String),
    signed_up_at  DateTime('UTC')
)
ENGINE = MergeTree
ORDER BY (tenant_id, user_id);

-- ~1M rows. Partitioned by month so time-bucketing and materialized view
-- examples have realistic parts to work with.
CREATE TABLE IF NOT EXISTS events
(
    event_id     UInt64,
    tenant_id    UInt32,
    user_id      UInt32,
    -- page_view | api_call | query_run | export | login | error
    event_type   LowCardinality(String),
    path         String,
    status_code  UInt16,
    -- request latency; long-tailed, for quantile / p95 recipes
    latency_ms   UInt32,
    -- desktop | mobile | tablet | api
    device       LowCardinality(String),
    occurred_at  DateTime('UTC')
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, occurred_at, event_id);

-- One row per subscription period. A tenant that upgrades gets a new row and
-- the previous row's ended_at is set, so MRR over time is a point-in-time
-- query over started_at / ended_at.
CREATE TABLE IF NOT EXISTS subscriptions
(
    subscription_id   UInt32,
    tenant_id         UInt32,
    -- starter | growth | enterprise (free tenants have no subscription)
    plan              LowCardinality(String),
    -- active | trialing | past_due | canceled
    status            LowCardinality(String),
    -- monthly | annual
    billing_interval  LowCardinality(String),
    -- amount charged per billing interval
    amount            Decimal(12, 2),
    currency          LowCardinality(String),
    started_at        Date,
    ended_at          Nullable(Date)
)
ENGINE = MergeTree
ORDER BY (tenant_id, started_at, subscription_id);
