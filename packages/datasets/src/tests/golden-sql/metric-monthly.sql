-- sql
SELECT toStartOfMonth(toDateTime64(analytics.orders.created_at, 9, 'UTC')) AS `period`, analytics.orders.status AS `status`, SUM(analytics.orders.amount_cents) AS `monthlyRevenue` FROM analytics.orders WHERE analytics.orders.tenant_id = ? GROUP BY `period`, `status` ORDER BY `period` ASC LIMIT 5
