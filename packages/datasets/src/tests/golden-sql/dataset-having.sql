-- sql
WITH base AS (SELECT customer_id AS `customerId`, SUM(amount_cents) AS `revenue`, COUNT(status) AS `orders` FROM analytics.orders WHERE tenant_id = ? GROUP BY `customerId`) SELECT `customerId`, `revenue`, ROUND((`revenue` / NULLIF(`orders`, 0)), 2) AS `averageOrderValue` FROM base WHERE `revenue` > ? AND (ROUND((`revenue` / NULLIF(`orders`, 0)), 2)) BETWEEN ? AND ?

-- parameters
["acme",100,10,50]
