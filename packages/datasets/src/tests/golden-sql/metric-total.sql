-- sql
SELECT analytics.orders.status AS `status`, SUM(analytics.orders.amount_cents) AS `totalRevenue` FROM analytics.orders WHERE analytics.orders.tenant_id = ? GROUP BY `status` LIMIT 5
