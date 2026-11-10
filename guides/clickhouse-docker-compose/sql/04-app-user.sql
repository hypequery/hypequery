-- Do not ship the default user to your app. With
-- CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1 the default user can create users
-- and grants in SQL; this one can only read the sample database.
CREATE USER IF NOT EXISTS clickhouse_docker_compose_app
    IDENTIFIED WITH sha256_password BY 'change-me-app-password'
    DEFAULT DATABASE hypequery_examples
    SETTINGS readonly = 1;

GRANT SELECT ON hypequery_examples.* TO clickhouse_docker_compose_app;

SHOW GRANTS FOR clickhouse_docker_compose_app;

SELECT name, auth_type, default_database
FROM system.users
WHERE name = 'clickhouse_docker_compose_app';

-- Clean up so the file can run again from scratch.
DROP USER IF EXISTS clickhouse_docker_compose_app;
