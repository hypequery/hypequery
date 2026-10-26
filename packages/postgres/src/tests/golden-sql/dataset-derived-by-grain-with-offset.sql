-- sql
WITH base AS (SELECT CAST((date_trunc('month', (CASE WHEN pg_typeof(created_at) = 'date'::regtype THEN (created_at)::timestamp AT TIME ZONE 'UTC' ELSE (created_at)::timestamptz END), 'UTC') AT TIME ZONE 'UTC') AS date) AS "period", SUM(amount_cents) AS "revenue", COUNT(status) AS "orders" FROM analytics.orders WHERE tenant_id = $1 GROUP BY date_trunc('month', (CASE WHEN pg_typeof(created_at) = 'date'::regtype THEN (created_at)::timestamp AT TIME ZONE 'UTC' ELSE (created_at)::timestamptz END), 'UTC')) SELECT "period", (ROUND(CAST((CAST("revenue" AS double precision) / NULLIF("orders", 0)) AS double precision) * CAST(1e2 AS double precision)) / CAST(1e2 AS double precision)) AS "averageOrderValue" FROM base ORDER BY "period" ASC OFFSET 20

-- parameters
["acme"]
