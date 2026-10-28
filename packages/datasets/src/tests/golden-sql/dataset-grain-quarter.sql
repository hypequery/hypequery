-- sql
SELECT toStartOfQuarter(toDateTime64(analytics.orders.created_at, 9, 'UTC')) AS `period`, analytics.orders.status AS `status`, SUM(analytics.orders.amount_cents) AS `revenue` FROM analytics.orders WHERE analytics.orders.tenant_id = ? GROUP BY `period`, `status` ORDER BY `period` ASC

-- parameters
["acme"]
