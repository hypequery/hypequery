-- sql
SELECT upper(region_code) AS `region`, SUM(amount_cents) AS `revenue` FROM analytics.orders WHERE tenant_id = ? AND status = ? GROUP BY `region`

-- parameters
["acme","paid"]
