-- Is the container up, which version is it, and who am I connected as?
-- `docker compose up -d --wait` only returns once the healthcheck passes, so
-- this is the first query a script can safely run.
SELECT
    version()         AS version,
    uptime()          AS uptime_seconds,
    timezone()        AS server_timezone,
    currentUser()     AS user,
    currentDatabase() AS database;

-- CLICKHOUSE_DB creates this database on the first start of an empty volume.
SELECT name, engine
FROM system.databases
WHERE name NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')
ORDER BY name;
