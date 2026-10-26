-- sql
SELECT "status", upper(region_code) AS "region", SUM("amount_cents") AS "revenue" FROM "analytics"."orders" WHERE "tenant_id" = $1 AND "status" IN ($2, $3) AND "status" LIKE $4 AND "created_at" >= (CASE WHEN pg_typeof((SELECT "created_at" FROM "analytics"."orders" LIMIT 0)) = 'date'::regtype THEN CAST($5 AS timestamp) AT TIME ZONE 'UTC' ELSE CAST($5 AS timestamp) AT TIME ZONE 'UTC' END) GROUP BY "status", upper(region_code) ORDER BY "revenue" DESC NULLS LAST LIMIT 26 OFFSET 50

-- parameters
["acme","paid","shipped","%a%","2026-01-01"]
