-- sql
SELECT upper(region_code) AS "region", SUM(amount_cents) AS "revenue" FROM analytics.orders WHERE tenant_id = $1 AND status = $2 GROUP BY upper(region_code)

-- parameters
["acme","paid"]
