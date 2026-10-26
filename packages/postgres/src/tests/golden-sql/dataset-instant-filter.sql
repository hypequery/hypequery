-- sql
SELECT SUM("amount_cents") AS "revenue" FROM "analytics"."orders" WHERE "tenant_id" = $1 AND "created_at" >= (CASE WHEN pg_typeof((SELECT "created_at" FROM "analytics"."orders" LIMIT 0)) = 'date'::regtype THEN CAST($2 AS timestamp) AT TIME ZONE 'UTC' ELSE CAST($2 AS timestamp) AT TIME ZONE 'UTC' END)

-- parameters
["acme","2026-01-02 05:00:00"]
