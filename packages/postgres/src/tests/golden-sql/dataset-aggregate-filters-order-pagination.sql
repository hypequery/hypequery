-- sql
SELECT status, upper(region_code) AS "region", SUM(amount_cents) AS "revenue" FROM analytics.orders WHERE tenant_id = $1 AND status IN ($2, $3) AND status LIKE $4 AND (CASE WHEN pg_typeof(created_at) = 'date'::regtype THEN (created_at)::timestamp ELSE (created_at)::timestamptz AT TIME ZONE 'UTC' END) >= $5 GROUP BY status, upper(region_code) ORDER BY "revenue" DESC NULLS LAST LIMIT 26 OFFSET 50

-- parameters
["acme","paid","shipped","%a%","2026-01-01"]
