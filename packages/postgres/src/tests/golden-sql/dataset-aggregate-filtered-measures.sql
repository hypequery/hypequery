-- sql
SELECT upper(region_code) AS "region", SUM(CASE WHEN (status = 'paid''s \ quote') THEN amount_cents ELSE 0 END) AS "paidRevenue", COUNT(CASE WHEN (is_gift = TRUE) THEN status ELSE NULL END) AS "giftOrders", COUNT(CASE WHEN (upper(region_code) IN ('EU', 'US')) THEN status ELSE NULL END) AS "regionalOrders", percentile_cont(0.95) WITHIN GROUP (ORDER BY CASE WHEN (status = 'paid') THEN amount_cents ELSE NULL END) AS "p95Paid" FROM analytics.orders WHERE tenant_id = $1 GROUP BY upper(region_code)

-- parameters
["acme"]
