-- sql
SELECT status, SUM(amount_cents) AS `revenue`, COUNT(status) AS `orders`, COUNT(DISTINCT customer_id) AS `buyers`, uniq(customer_id) AS `approxBuyers`, AVG(amount_cents) AS `avgAmount`, MIN(amount_cents) AS `minAmount`, MAX(amount_cents) AS `maxAmount`, quantile(0.95)(amount_cents) AS `p95`, argMax(upper(region_code), amount_cents) AS `topRegion`, argMin(upper(region_code), amount_cents) AS `bottomRegion`, stddevSamp(amount_cents) AS `spread`, varSamp(amount_cents) AS `variance` FROM analytics.orders WHERE tenant_id = ? GROUP BY status

-- parameters
["acme"]
