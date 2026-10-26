-- sql
SELECT (date_trunc('day', (CASE WHEN pg_typeof("created_at") = 'date'::regtype THEN ("created_at")::timestamp AT TIME ZONE 'America/New_York' ELSE ("created_at")::timestamptz END), 'America/New_York') AT TIME ZONE 'America/New_York') AS "period", SUM("amount_cents") AS "revenue" FROM "analytics"."orders" WHERE "tenant_id" = $1 AND "created_at" >= (CASE WHEN pg_typeof((SELECT "created_at" FROM "analytics"."orders" LIMIT 0)) = 'date'::regtype THEN CAST($2 AS timestamp) AT TIME ZONE 'UTC' ELSE CAST($2 AS timestamp) AT TIME ZONE 'America/New_York' END) GROUP BY date_trunc('day', (CASE WHEN pg_typeof("created_at") = 'date'::regtype THEN ("created_at")::timestamp AT TIME ZONE 'America/New_York' ELSE ("created_at")::timestamptz END), 'America/New_York') ORDER BY "period" ASC

-- parameters
["acme","2026-01-02"]
