-- sql
SELECT upper(region_code) AS `region`, SUM(if((analytics.orders.status = 'paid''s \\ quote'), analytics.orders.amount_cents, 0)) AS `paidRevenue`, COUNT(if((analytics.orders.is_gift = 1), analytics.orders.status, NULL)) AS `giftOrders`, COUNT(if((upper(region_code) IN ('EU', 'US')), analytics.orders.status, NULL)) AS `regionalOrders`, quantile(0.95)(if((analytics.orders.status = 'paid'), analytics.orders.amount_cents, NULL)) AS `p95Paid` FROM analytics.orders WHERE analytics.orders.tenant_id = ? GROUP BY `region`

-- parameters
["acme"]
