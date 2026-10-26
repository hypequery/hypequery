-- sql
SELECT (date_trunc('day', (CASE WHEN pg_typeof(created_at) = 'date'::regtype THEN (created_at)::timestamp AT TIME ZONE 'America/New_York' ELSE (created_at)::timestamptz END), 'America/New_York') AT TIME ZONE 'America/New_York') AS "period", SUM(amount_cents) AS "revenue" FROM analytics.orders WHERE tenant_id = $1 AND (CASE WHEN pg_typeof(created_at) = 'date'::regtype THEN (created_at)::timestamp ELSE (created_at)::timestamptz AT TIME ZONE 'America/New_York' END) >= $2 GROUP BY date_trunc('day', (CASE WHEN pg_typeof(created_at) = 'date'::regtype THEN (created_at)::timestamp AT TIME ZONE 'America/New_York' ELSE (created_at)::timestamptz END), 'America/New_York') ORDER BY "period" ASC

-- parameters
["acme","2026-01-02"]
