-- List materialized views in the current database.
SELECT name, engine, create_table_query
FROM system.tables
WHERE database = currentDatabase() AND engine = 'MaterializedView';

-- Show one view's definition.
SHOW CREATE TABLE blog_events_daily_mv;

-- Which target table does a view write to? Query its dependencies.
SELECT name, dependencies_table
FROM system.tables
WHERE database = currentDatabase() AND name = 'events';
