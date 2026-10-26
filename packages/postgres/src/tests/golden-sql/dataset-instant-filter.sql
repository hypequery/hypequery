-- sql
SELECT SUM(amount_cents) AS "revenue" FROM analytics.orders WHERE tenant_id = $1 AND (CASE WHEN pg_typeof(created_at) = 'date'::regtype THEN (created_at)::timestamp ELSE (created_at)::timestamptz AT TIME ZONE 'UTC' END) >= $2

-- parameters
["acme","2026-01-02 05:00:00"]
