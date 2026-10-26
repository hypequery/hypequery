-- sql
WITH base AS (SELECT status, SUM(amount_cents) AS "revenue", COUNT(status) AS "orders", AVG(amount_cents) AS "avgAmount" FROM analytics.orders WHERE tenant_id = $1 GROUP BY status) SELECT "status", CAST(ROUND(CAST((CAST("revenue" AS double precision) / NULLIF("orders", 0)) AS numeric), 2) AS double precision) AS "averageOrderValue", COALESCE(FLOOR((("revenue" + ("avgAmount" - "orders")) * CEIL((CAST("revenue" AS double precision) / NULLIF("avgAmount", 0))))), 0) AS "everyFormula" FROM base ORDER BY "averageOrderValue" DESC NULLS LAST LIMIT 11

-- parameters
["acme"]
