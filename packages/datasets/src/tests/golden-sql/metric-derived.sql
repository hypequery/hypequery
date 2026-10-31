-- sql
WITH base AS (SELECT analytics.orders.status AS `status`, SUM(analytics.orders.amount_cents) AS `revenue`, COUNT(analytics.orders.status) AS `orders` FROM analytics.orders WHERE analytics.orders.tenant_id = ? GROUP BY `status`) SELECT `status`, ROUND((toFloat64(`revenue`) / NULLIF(`orders`, 0)), 2) AS `aov` FROM base LIMIT 5
