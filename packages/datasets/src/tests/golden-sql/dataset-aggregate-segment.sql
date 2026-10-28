-- sql
SELECT upper(region_code) AS `region`, SUM(analytics.orders.amount_cents) AS `revenue` FROM analytics.orders WHERE analytics.orders.tenant_id = ? AND analytics.orders.status = ? GROUP BY `region`

-- parameters
["acme","paid"]
