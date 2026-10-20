-- sql
SELECT status, upper(region_code) AS region, SUM(amount_cents) AS revenue FROM analytics.orders WHERE tenant_id = ? AND status IN (?, ?) AND status LIKE ? AND toDateTime64(created_at, 9, 'UTC') >= ? GROUP BY status, region ORDER BY revenue DESC LIMIT 26 OFFSET 50

-- parameters
["acme","paid","shipped","%a%","2026-01-01"]
