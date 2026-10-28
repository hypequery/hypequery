-- sql
SELECT analytics.orders.status AS `status`, SUM(analytics.orders.amount_cents) AS `revenue`, COUNT(analytics.orders.status) AS `orders`, COUNT(DISTINCT analytics.orders.customer_id) AS `buyers`, uniq(analytics.orders.customer_id) AS `approxBuyers`, AVG(analytics.orders.amount_cents) AS `avgAmount`, MIN(analytics.orders.amount_cents) AS `minAmount`, MAX(analytics.orders.amount_cents) AS `maxAmount`, quantile(0.95)(analytics.orders.amount_cents) AS `p95`, argMax(upper(region_code), analytics.orders.amount_cents) AS `topRegion`, argMin(upper(region_code), analytics.orders.amount_cents) AS `bottomRegion`, stddevSamp(analytics.orders.amount_cents) AS `spread`, varSamp(analytics.orders.amount_cents) AS `variance` FROM analytics.orders WHERE analytics.orders.tenant_id = ? GROUP BY `status`

-- parameters
["acme"]
