-- sql
WITH base AS (SELECT "customer_id" AS "customerId", SUM("amount_cents") AS "revenue", COUNT("status") AS "orders" FROM "analytics"."orders" WHERE "tenant_id" = $1 GROUP BY "customer_id") SELECT "customerId", "revenue", (ROUND(CAST((CAST("revenue" AS double precision) / NULLIF("orders", 0)) AS double precision) * CAST(1e2 AS double precision)) / CAST(1e2 AS double precision)) AS "averageOrderValue" FROM base WHERE "revenue" > $2 AND ((ROUND(CAST((CAST("revenue" AS double precision) / NULLIF("orders", 0)) AS double precision) * CAST(1e2 AS double precision)) / CAST(1e2 AS double precision))) BETWEEN $3 AND $4

-- parameters
["acme",100,10,50]
