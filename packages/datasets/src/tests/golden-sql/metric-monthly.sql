-- sql
SELECT toStartOfMonth(toDateTime64(created_at, 9, 'UTC')) AS period, status, SUM(amount_cents) AS monthlyRevenue FROM analytics.orders WHERE tenant_id = ? GROUP BY period, status ORDER BY period ASC LIMIT 5
