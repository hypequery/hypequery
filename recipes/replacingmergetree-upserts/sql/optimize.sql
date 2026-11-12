-- Let merges run again and force one: OPTIMIZE ... FINAL merges every part of
-- the table into one, keeping the highest version per tenant_id.
SYSTEM START MERGES replacingmergetree_upserts_tenants;

OPTIMIZE TABLE replacingmergetree_upserts_tenants FINAL;
