-- sql
SELECT status, SUM(amount_cents) AS "revenue", COUNT(status) AS "orders", COUNT(DISTINCT customer_id) AS "buyers", COUNT(DISTINCT customer_id) AS "approxBuyers", AVG(amount_cents) AS "avgAmount", MIN(amount_cents) AS "minAmount", MAX(amount_cents) AS "maxAmount", percentile_cont(0.95) WITHIN GROUP (ORDER BY amount_cents) AS "p95", (ARRAY_AGG(upper(region_code) ORDER BY amount_cents DESC) FILTER (WHERE amount_cents IS NOT NULL))[1] AS "topRegion", (ARRAY_AGG(upper(region_code) ORDER BY amount_cents ASC) FILTER (WHERE amount_cents IS NOT NULL))[1] AS "bottomRegion", stddev_samp(amount_cents) AS "spread", var_samp(amount_cents) AS "variance" FROM analytics.orders WHERE tenant_id = $1 GROUP BY status

-- parameters
["acme"]
