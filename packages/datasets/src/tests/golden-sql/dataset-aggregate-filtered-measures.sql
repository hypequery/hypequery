-- sql
SELECT upper(region_code) AS region, SUM(if((status = 'paid''s \\ quote'), amount_cents, 0)) AS paidRevenue, COUNT(if((is_gift = 1), status, NULL)) AS giftOrders, COUNT(if((upper(region_code) IN ('EU', 'US')), status, NULL)) AS regionalOrders, quantile(0.95)(if((status = 'paid'), amount_cents, NULL)) AS p95Paid FROM analytics.orders WHERE tenant_id = ? GROUP BY region

-- parameters
["acme"]
