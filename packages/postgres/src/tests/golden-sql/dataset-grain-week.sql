-- sql
SELECT (date_trunc('week', ((CASE WHEN pg_typeof(created_at) = 'date'::regtype THEN (created_at)::timestamp ELSE (created_at)::timestamptz AT TIME ZONE 'UTC' END)) + INTERVAL '1 day') - INTERVAL '1 day')::date AS "period", status, SUM(amount_cents) AS "revenue" FROM analytics.orders WHERE tenant_id = $1 GROUP BY (date_trunc('week', ((CASE WHEN pg_typeof(created_at) = 'date'::regtype THEN (created_at)::timestamp ELSE (created_at)::timestamptz AT TIME ZONE 'UTC' END)) + INTERVAL '1 day') - INTERVAL '1 day')::date, status ORDER BY "period" ASC

-- parameters
["acme"]
