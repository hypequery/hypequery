-- sql
SELECT date_trunc('hour', (CASE WHEN pg_typeof(created_at) = 'date'::regtype THEN (created_at)::timestamp ELSE (created_at)::timestamptz AT TIME ZONE 'UTC' END)) AS "period", status, SUM(amount_cents) AS "revenue" FROM analytics.orders WHERE tenant_id = $1 GROUP BY date_trunc('hour', (CASE WHEN pg_typeof(created_at) = 'date'::regtype THEN (created_at)::timestamp ELSE (created_at)::timestamptz AT TIME ZONE 'UTC' END)), status ORDER BY "period" ASC

-- parameters
["acme"]
