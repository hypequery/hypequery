-- sql
SELECT customer.country_code AS `customer.country`, SUM(analytics.orders.amount_cents) AS revenue, COUNT(DISTINCT if(isNotNull(customer._hq_match), customer.customer_id, NULL)) AS `customer.customers` FROM analytics.orders LEFT ANY JOIN (SELECT `id`, `tenant_id`, `customer_id`, `country_code`, `tier`, toNullable(1) AS `_hq_match` FROM `analytics`.`customers`) AS customer ON analytics.orders.customerId = customer.id AND customer.tenant_id = ? WHERE analytics.orders.tenant_id = ? GROUP BY `customer.country`

-- parameters
["acme","acme"]
