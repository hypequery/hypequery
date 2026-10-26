-- sql
WITH base AS (SELECT "status", SUM("amount_cents") AS "revenue", COUNT("status") AS "orders", AVG("amount_cents") AS "avgAmount" FROM "analytics"."orders" WHERE "tenant_id" = $1 GROUP BY "status") SELECT "status", (ROUND(CAST((CAST("revenue" AS double precision) / NULLIF(NULLIF("orders", 0), 0)) AS double precision) * CAST(1e2 AS double precision)) / CAST(1e2 AS double precision)) AS "averageOrderValue", COALESCE(FLOOR((("revenue" + ("avgAmount" - "orders")) * CEIL((CAST("revenue" AS double precision) / NULLIF(NULLIF("avgAmount", 0), 0))))), 0) AS "everyFormula" FROM base ORDER BY "averageOrderValue" DESC NULLS LAST LIMIT 11

-- parameters
["acme"]
