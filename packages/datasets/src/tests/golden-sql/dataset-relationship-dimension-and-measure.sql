-- sql
SELECT if(isNotNull(customer._hq_match), customer.country_code, NULL) AS `customer.country`, SUM(analytics.orders.amount_cents) AS `revenue`, COUNT(DISTINCT if(isNotNull(customer._hq_match), customer.customer_id, NULL)) AS `customer.customers` FROM analytics.orders LEFT ANY JOIN (SELECT `country_code`, `customer_id`, `tenant_id`, `tier`, toNullable(1) AS `_hq_match` FROM `analytics`.`customers`) AS customer ON analytics.orders.customer_id = customer.customer_id AND customer.tenant_id = ? WHERE analytics.orders.tenant_id = ? GROUP BY if(isNotNull(customer._hq_match), customer.country_code, NULL)

-- parameters
["acme","acme"]
