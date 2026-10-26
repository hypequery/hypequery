-- sql
WITH base AS (SELECT date_trunc('month', (CASE WHEN pg_typeof(created_at) = 'date'::regtype THEN (created_at)::timestamp ELSE (created_at)::timestamptz AT TIME ZONE 'UTC' END))::date AS "period", SUM(amount_cents) AS "revenue", COUNT(status) AS "orders" FROM analytics.orders WHERE tenant_id = $1 GROUP BY date_trunc('month', (CASE WHEN pg_typeof(created_at) = 'date'::regtype THEN (created_at)::timestamp ELSE (created_at)::timestamptz AT TIME ZONE 'UTC' END))::date) SELECT "period", CAST(ROUND(CAST((CAST("revenue" AS double precision) / NULLIF("orders", 0)) AS numeric), 2) AS double precision) AS "averageOrderValue" FROM base ORDER BY "period" ASC OFFSET 20

-- parameters
["acme"]
