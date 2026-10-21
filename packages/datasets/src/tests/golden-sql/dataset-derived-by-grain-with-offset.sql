-- sql
WITH base AS (SELECT toStartOfMonth(toDateTime64(created_at, 9, 'UTC')) AS `period`, SUM(amount_cents) AS `revenue`, COUNT(status) AS `orders` FROM analytics.orders WHERE tenant_id = ? GROUP BY `period`) SELECT `period`, ROUND((`revenue` / NULLIF(`orders`, 0)), 2) AS `averageOrderValue` FROM base ORDER BY `period` ASC OFFSET 20

-- parameters
["acme"]
