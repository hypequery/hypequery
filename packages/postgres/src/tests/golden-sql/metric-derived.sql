-- sql
WITH base AS (SELECT status, SUM(amount_cents) AS "revenue", COUNT(status) AS "orders" FROM analytics.orders WHERE tenant_id = $1 GROUP BY status) SELECT "status", CAST(ROUND(CAST((CAST("revenue" AS double precision) / NULLIF("orders", 0)) AS numeric), 2) AS double precision) AS "aov" FROM base LIMIT 5
