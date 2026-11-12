-- A tenants table you upsert into. ReplacingMergeTree keeps, per sorting key
-- (tenant_id), the row with the highest `version`; when `is_deleted` = 1 on
-- that row, the key counts as deleted. Both only happen at merge time or when
-- a query asks for FINAL.
DROP TABLE IF EXISTS replacingmergetree_upserts_tenants;

CREATE TABLE replacingmergetree_upserts_tenants
(
    tenant_id   UInt32,
    name        String,
    plan        LowCardinality(String),
    region      LowCardinality(String),
    version     DateTime('UTC'),
    is_deleted  UInt8
)
ENGINE = ReplacingMergeTree(version, is_deleted)
ORDER BY tenant_id;

-- Hold merges so the "before OPTIMIZE" state is the same on every run. A
-- background merge could otherwise deduplicate some parts and not others
-- between two queries. Test technique only; never do this in production.
SYSTEM STOP MERGES replacingmergetree_upserts_tenants;

-- 1. Initial load: every seed tenant, version = when it was created.
INSERT INTO replacingmergetree_upserts_tenants
SELECT tenant_id, name, plan, region, created_at, 0 FROM tenants;

-- 2. Upserts: every 10th tenant below enterprise moves up one plan.
INSERT INTO replacingmergetree_upserts_tenants
SELECT tenant_id, name,
       multiIf(plan = 'free', 'starter', plan = 'starter', 'growth', 'enterprise'),
       region, toDateTime('2026-11-01 00:00:00', 'UTC'), 0
FROM tenants
WHERE tenant_id % 10 = 0 AND plan != 'enterprise';

-- 3. Deletes: every 25th tenant churns. A delete is an insert with is_deleted = 1.
INSERT INTO replacingmergetree_upserts_tenants
SELECT tenant_id, name, plan, region, toDateTime('2026-11-02 00:00:00', 'UTC'), 1
FROM tenants
WHERE tenant_id % 25 = 0;

-- 4. A late, stale message: an old 'free' row for every 10th tenant, inserted
--    last but versioned a day before the tenant existed. It must lose.
INSERT INTO replacingmergetree_upserts_tenants
SELECT tenant_id, name, 'free', region, created_at - INTERVAL 1 DAY, 0
FROM tenants
WHERE tenant_id % 10 = 0;

-- The argMax pattern as a view: latest value of each column per key, by
-- version, with deleted keys dropped. Correct without FINAL or merges.
CREATE OR REPLACE VIEW replacingmergetree_upserts_tenants_latest AS
SELECT
    tenant_id,
    argMax(name, version)       AS name,
    argMax(plan, version)       AS plan,
    argMax(region, version)     AS region,
    max(version)                AS latest_version
FROM replacingmergetree_upserts_tenants
GROUP BY tenant_id
HAVING argMax(is_deleted, version) = 0;
