-- The aggregation shapes that make an app's Postgres slow: every query below
-- reads every row of a 1M-row events table. The Postgres version of each is
-- in the guide; on the same laptop they took 0.15 to 1.7 s there and 20 to
-- 65 ms here.

-- 1. A daily time series per event type over the whole year.
SELECT toDate(occurred_at) AS day, event_type, count() AS events
FROM events
GROUP BY day, event_type
ORDER BY day, event_type;

-- 2. Distinct users per month (Postgres: count(DISTINCT user_id)).
SELECT toStartOfMonth(occurred_at) AS month, uniqExact(user_id) AS active_users
FROM events
GROUP BY month
ORDER BY month;

-- 3. Exact p95 latency per event type. quantileExactInclusive matches
-- Postgres percentile_cont; quantile(0.95) is the cheaper approximate one.
SELECT event_type, quantileExactInclusive(0.95)(latency_ms) AS p95_latency_ms
FROM events
GROUP BY event_type
ORDER BY p95_latency_ms DESC;

-- 4. Top 3 paths for every tenant (Postgres: row_number() in a subquery).
SELECT tenant_id, path, count() AS events
FROM events
GROUP BY tenant_id, path
ORDER BY tenant_id, events DESC, path
LIMIT 3 BY tenant_id;

-- 5. Server error rate by plan: the fact table joined to a small dimension.
SELECT t.plan, countIf(e.status_code >= 500) / count() AS error_rate
FROM events AS e
INNER JOIN tenants AS t ON t.tenant_id = e.tenant_id
GROUP BY t.plan
ORDER BY error_rate DESC;
