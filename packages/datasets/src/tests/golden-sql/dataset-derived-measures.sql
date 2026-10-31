-- sql
WITH base AS (SELECT analytics.orders.status AS `status`, SUM(analytics.orders.amount_cents) AS `revenue`, COUNT(analytics.orders.status) AS `orders`, AVG(analytics.orders.amount_cents) AS `avgAmount` FROM analytics.orders WHERE analytics.orders.tenant_id = ? GROUP BY `status`) SELECT `status`, ROUND((toFloat64(`revenue`) / NULLIF(`orders`, 0)), 2) AS `averageOrderValue`, COALESCE(FLOOR(((`revenue` + (`avgAmount` - `orders`)) * CEIL((toFloat64(`revenue`) / NULLIF(`avgAmount`, 0))))), 0) AS `everyFormula` FROM base ORDER BY `averageOrderValue` DESC LIMIT 11

-- parameters
["acme"]
