-- sql
SELECT "status", SUM("amount_cents") AS "totalRevenue" FROM "analytics"."orders" WHERE "tenant_id" = $1 GROUP BY "status" LIMIT 5
