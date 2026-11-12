-- A private copy of the seed tenants, so the recipe can change a plan and
-- show the dictionary catching up without touching the shared seed.
DROP DICTIONARY IF EXISTS dictionary_lookups_tenants;

DROP TABLE IF EXISTS dictionary_lookups_tenants_source;

CREATE TABLE dictionary_lookups_tenants_source AS tenants
ENGINE = MergeTree
ORDER BY tenant_id;

INSERT INTO dictionary_lookups_tenants_source SELECT * FROM tenants;

-- The dictionary: tenant_id -> (plan, region), held in memory as a hash
-- table and reloaded from the source every 5 to 10 minutes.
-- A dictionary reads its source over its own connection, so even a local
-- table needs credentials; {user} and {password} are filled in by
-- src/setup.ts from CLICKHOUSE_USERNAME / CLICKHOUSE_PASSWORD. The password
-- shows as [HIDDEN] in SHOW CREATE DICTIONARY and system.query_log.
CREATE DICTIONARY dictionary_lookups_tenants
(
    tenant_id  UInt64,
    plan       String,
    region     String
)
PRIMARY KEY tenant_id
SOURCE(CLICKHOUSE(TABLE 'dictionary_lookups_tenants_source' DB '{database}' USER '{user}' PASSWORD '{password}'))
LAYOUT(HASHED())
LIFETIME(MIN 300 MAX 600);

-- Dictionaries load on first use by default; load it now so the first
-- query does not pay for it.
SYSTEM RELOAD DICTIONARY dictionary_lookups_tenants;
