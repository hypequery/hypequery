-- sql
SELECT CAST((((date_trunc('week', ((CASE WHEN pg_typeof("created_at") = 'date'::regtype THEN ("created_at")::timestamp AT TIME ZONE 'UTC' ELSE ("created_at")::timestamptz END) AT TIME ZONE 'UTC') + INTERVAL '1 day') - INTERVAL '1 day') AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS date) AS "period", "status", SUM("amount_cents") AS "revenue" FROM "analytics"."orders" WHERE "tenant_id" = $1 GROUP BY ((date_trunc('week', ((CASE WHEN pg_typeof("created_at") = 'date'::regtype THEN ("created_at")::timestamp AT TIME ZONE 'UTC' ELSE ("created_at")::timestamptz END) AT TIME ZONE 'UTC') + INTERVAL '1 day') - INTERVAL '1 day') AT TIME ZONE 'UTC'), "status" ORDER BY "period" ASC

-- parameters
["acme"]
