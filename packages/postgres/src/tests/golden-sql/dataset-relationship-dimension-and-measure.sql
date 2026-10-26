-- sql
SELECT CASE WHEN (customer._hq_match IS NOT NULL) THEN customer."country_code" ELSE NULL END AS "customer.country", SUM("analytics"."orders"."amount_cents") AS "revenue", COUNT(DISTINCT CASE WHEN (customer._hq_match IS NOT NULL) THEN customer."customer_id" ELSE NULL END) AS "customer.customers" FROM "analytics"."orders" LEFT JOIN LATERAL (SELECT * FROM (SELECT "country_code", "customer_id", "tenant_id", "tier", 1 AS "_hq_match" FROM "analytics"."customers") AS customer WHERE "analytics"."orders"."customer_id" = customer."customer_id" AND customer."tenant_id" = $1 LIMIT 1) AS customer ON TRUE WHERE "analytics"."orders"."tenant_id" = $2 GROUP BY CASE WHEN (customer._hq_match IS NOT NULL) THEN customer."country_code" ELSE NULL END

-- parameters
["acme","acme"]
