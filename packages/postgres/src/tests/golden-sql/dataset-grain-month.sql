-- sql
SELECT CAST((date_trunc('month', (CASE WHEN pg_typeof("created_at") = 'date'::regtype THEN ("created_at")::timestamp AT TIME ZONE 'UTC' ELSE ("created_at")::timestamptz END), 'UTC') AT TIME ZONE 'UTC') AS date) AS "period", "status", SUM("amount_cents") AS "revenue" FROM "analytics"."orders" WHERE "tenant_id" = $1 GROUP BY date_trunc('month', (CASE WHEN pg_typeof("created_at") = 'date'::regtype THEN ("created_at")::timestamp AT TIME ZONE 'UTC' ELSE ("created_at")::timestamptz END), 'UTC'), "status" ORDER BY "period" ASC

-- parameters
["acme"]
