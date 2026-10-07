/** Detect backend intent without reading values into diagnostics or contacting a server. */
export function detectDatabaseFromEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): 'clickhouse' | 'bigquery' | undefined {
  if (env.CLICKHOUSE_HOST || env.CLICKHOUSE_URL || env.CLICKHOUSE_DATABASE) return 'clickhouse';
  if (env.BIGQUERY_PROJECT_ID || env.GOOGLE_APPLICATION_CREDENTIALS) return 'bigquery';
  return undefined;
}
