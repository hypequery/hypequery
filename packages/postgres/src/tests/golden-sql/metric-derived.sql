-- sql
WITH base AS (SELECT "status", SUM("amount_cents") AS "revenue", COUNT("status") AS "orders" FROM "analytics"."orders" WHERE "tenant_id" = $1 GROUP BY "status") SELECT "status", (ROUND(CAST((CAST("revenue" AS double precision) / NULLIF(NULLIF("orders", 0), 0)) AS double precision) * CAST(1e2 AS double precision)) / CAST(1e2 AS double precision)) AS "aov" FROM base LIMIT 5
