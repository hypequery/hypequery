-- sql
SELECT analytics.orders.status AS `status`, upper(region_code) AS `region`, SUM(analytics.orders.amount_cents) AS `revenue` FROM analytics.orders WHERE analytics.orders.tenant_id = ? AND analytics.orders.status IN (?, ?) AND analytics.orders.status LIKE ? AND toDateTime64(analytics.orders.created_at, 9, 'UTC') >= ? GROUP BY `status`, `region` ORDER BY `revenue` DESC LIMIT 26 OFFSET 50

-- parameters
["acme","paid","shipped","%a%","2026-01-01"]
