-- sql
WITH base AS (SELECT status, SUM(amount_cents) AS revenue, COUNT(status) AS orders, AVG(amount_cents) AS avgAmount FROM analytics.orders WHERE tenant_id = ? GROUP BY status) SELECT `status`, ROUND((`revenue` / NULLIF(`orders`, 0)), 2) AS `averageOrderValue`, COALESCE(FLOOR(((`revenue` + (`avgAmount` - `orders`)) * CEIL((`revenue` / NULLIF(`avgAmount`, 0))))), 0) AS `everyFormula` FROM base ORDER BY `averageOrderValue` DESC LIMIT 11

-- parameters
["acme"]
