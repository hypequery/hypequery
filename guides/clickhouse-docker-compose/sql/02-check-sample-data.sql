-- After `pnpm seed`: four tables, one million events, and how much disk they
-- take inside the clickhouse-data volume.
SELECT
    table,
    sum(rows)                                     AS rows,
    count()                                       AS active_parts,
    formatReadableSize(sum(data_compressed_bytes))   AS on_disk,
    formatReadableSize(sum(data_uncompressed_bytes)) AS uncompressed
FROM system.parts
WHERE database = currentDatabase()
  AND active
  AND table IN ('tenants', 'users', 'events', 'subscriptions')
GROUP BY table
ORDER BY rows DESC;

-- The same order-independent checksum `pnpm seed` compares with checksums.json.
SELECT count() AS rows, sum(cityHash64(*)) AS checksum
FROM events;

-- A first real query: events and active users per month.
SELECT
    toStartOfMonth(occurred_at) AS month,
    count()                     AS events,
    uniqExact(user_id)          AS active_users
FROM events
GROUP BY month
ORDER BY month;
