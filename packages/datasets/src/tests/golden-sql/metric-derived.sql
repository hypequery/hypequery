-- sql
WITH base AS (SELECT status, SUM(amount_cents) AS `revenue`, COUNT(status) AS `orders` FROM analytics.orders WHERE tenant_id = ? GROUP BY status) SELECT `status`, ROUND((`revenue` / NULLIF(`orders`, 0)), 2) AS `aov` FROM base LIMIT 5
