-- sql
SELECT toStartOfDay(toDateTime64(analytics.orders.created_at, 9, 'America/New_York')) AS `period`, SUM(analytics.orders.amount_cents) AS `revenue` FROM analytics.orders WHERE analytics.orders.tenant_id = ? AND toDateTime64(analytics.orders.created_at, 9, 'America/New_York') >= ? GROUP BY `period` ORDER BY `period` ASC

-- parameters
["acme","2026-01-02"]
