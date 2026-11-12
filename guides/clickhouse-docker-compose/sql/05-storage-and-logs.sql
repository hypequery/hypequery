-- Where the data lives inside the container: /var/lib/clickhouse/, which the
-- compose file mounts from the clickhouse-data volume.
SELECT
    name,
    path,
    formatReadableSize(free_space)  AS free,
    formatReadableSize(total_space) AS total
FROM system.disks;

-- Memory ClickHouse will allow itself; it follows the container's limit when
-- one is set (deploy.resources.limits.memory or `docker run --memory`).
SELECT formatReadableSize(toUInt64(value)) AS max_server_memory_usage
FROM system.server_settings
WHERE name = 'max_server_memory_usage';

-- The slowest recent queries. query_log is flushed every few seconds, so an
-- empty result right after startup is normal.
SELECT
    event_time,
    query_duration_ms,
    read_rows,
    formatReadableSize(memory_usage) AS memory,
    substring(query, 1, 80)          AS query
FROM system.query_log
WHERE type = 'QueryFinish' AND event_date >= today() - 1
ORDER BY query_duration_ms DESC
LIMIT 5;

-- Clean up the table from 03-your-first-table.sql.
DROP TABLE IF EXISTS clickhouse_docker_compose_page_views;
