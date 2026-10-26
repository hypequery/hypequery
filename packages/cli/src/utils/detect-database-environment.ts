/** Detect backend intent without reading values into diagnostics or contacting a server. */
export function detectDatabaseFromEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): 'clickhouse' | 'postgres' | 'bigquery' | undefined {
  if (env.CLICKHOUSE_HOST || env.CLICKHOUSE_URL || env.CLICKHOUSE_DATABASE) return 'clickhouse';
  // DATABASE_URL counts only when it is a Postgres URL; many tools set it.
  if (env.HYPEQUERY_POSTGRES_URL || env.POSTGRES_URL || /^postgres(?:ql)?:\/\//.test(env.DATABASE_URL ?? '')) {
    return 'postgres';
  }
  if (env.BIGQUERY_PROJECT_ID || env.GOOGLE_APPLICATION_CREDENTIALS) return 'bigquery';
  return undefined;
}
