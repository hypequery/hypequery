-- sql
WITH base AS (SELECT toStartOfWeek(toDateTime64(created_at, 9, 'UTC')) AS `period`, status, SUM(amount_cents) AS `revenue`, COUNT(status) AS `orders` FROM analytics.orders WHERE tenant_id = ? GROUP BY `period`, status) SELECT `period`, `status`, (`revenue`) / (NULLIF(`orders`, 0)) AS `monthlyAov` FROM base ORDER BY `period` LIMIT 5
