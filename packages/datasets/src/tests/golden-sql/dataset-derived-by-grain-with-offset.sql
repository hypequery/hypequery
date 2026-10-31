-- sql
WITH base AS (SELECT toStartOfMonth(toDateTime64(analytics.orders.created_at, 9, 'UTC')) AS `period`, SUM(analytics.orders.amount_cents) AS `revenue`, COUNT(analytics.orders.status) AS `orders` FROM analytics.orders WHERE analytics.orders.tenant_id = ? GROUP BY `period`) SELECT `period`, ROUND((toFloat64(`revenue`) / NULLIF(`orders`, 0)), 2) AS `averageOrderValue` FROM base ORDER BY `period` ASC OFFSET 20

-- parameters
["acme"]
