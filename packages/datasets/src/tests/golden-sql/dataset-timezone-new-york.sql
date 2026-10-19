-- sql
SELECT toStartOfDay(toDateTime64(created_at, 9, 'America/New_York')) AS period, SUM(amount_cents) AS revenue FROM analytics.orders WHERE tenant_id = ? AND toDateTime64(created_at, 9, 'America/New_York') >= ? GROUP BY period ORDER BY period ASC

-- parameters
["acme","2026-01-02"]
