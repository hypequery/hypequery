-- sql
WITH base AS (SELECT analytics.orders.customer_id AS `customerId`, SUM(analytics.orders.amount_cents) AS `revenue`, COUNT(analytics.orders.status) AS `orders` FROM analytics.orders WHERE analytics.orders.tenant_id = ? GROUP BY `customerId`) SELECT `customerId`, `revenue`, ROUND((toFloat64(`revenue`) / NULLIF(`orders`, 0)), 2) AS `averageOrderValue` FROM base WHERE `revenue` > ? AND (ROUND((toFloat64(`revenue`) / NULLIF(`orders`, 0)), 2)) BETWEEN ? AND ?

-- parameters
["acme",100,10,50]
