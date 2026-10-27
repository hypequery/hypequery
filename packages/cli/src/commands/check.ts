import path from 'node:path';
import { exitWith } from '../utils/command-exit.js';
import { findApiFileForPath, findQueriesFile } from '../utils/find-files.js';
import { loadApiModule } from '../utils/load-api.js';
import { logger } from '../utils/logger.js';
import { readServeMcpSource } from '../utils/mcp-source.js';
import { importFromProject } from '../utils/project-root.js';
import { resolveDatasetsDatabase, type DatasetsDatabase } from '../utils/datasets-database.js';
import { postgresUrlFromEnv, withPostgresClient } from '../generators/introspection/postgres.js';
import { createClient, ClickHouseLogLevel } from '@clickhouse/client';
import { getClickHouseConfigFromEnv } from '../utils/clickhouse-client.js';
import { clickhouseExplainer, postgresExplainer } from '../utils/check/explain.js';
import {
  checkDatasets,
  type CheckableDataset,
  type CompileQuery,
  type DatasetCheckResult,
  type ExplainStatement,
} from '../utils/check/run-check.js';

export interface CheckOptions {
  /** Analytics directory, matching `hypequery dev --path`. */
  path?: string;
  /** `clickhouse` or `postgres`; detected from the environment when omitted. */
  database?: string;
  /** Tenant id compiled into tenant-scoped queries (only planned, never run). */
  tenant?: string;
}

/** Engine access, injectable for tests. */
export interface CheckDependencies {
  loadApi?: (file: string) => Promise<unknown>;
  /** Run *work* with a planner for the engine, then release the connection. */
  withExplainer?: (
    database: DatasetsDatabase,
    entrypoint: string,
    work: (explain: ExplainStatement) => Promise<DatasetCheckResult[]>,
  ) => Promise<DatasetCheckResult[]>;
}

/** Planned only, so any value works; this one is recognisable in server logs. */
const CHECK_TENANT = '__hypequery_check__';

interface DatasetClientLike {
  compileDataset(dataset: unknown, query?: unknown, context?: unknown): {
    sql: string;
    parameters: readonly unknown[];
    preflightStatements: readonly { sql: string; parameters: readonly unknown[] }[];
  };
}

function fail(message: string, hints: readonly string[] = []): never {
  logger.error(message);
  if (hints.length > 0) {
    logger.newline();
    for (const hint of hints) logger.indent(hint);
  }
  logger.newline();
  exitWith(1, 'failure', 'validation_failed');
}

/**
 * Compile representative queries for every dataset the API registers and have
 * the database plan each one with `EXPLAIN`. Nothing is executed. Exits 1 if
 * any dataset is refused by its engine, fails to compile or fails to plan.
 */
export async function checkCommand(
  file?: string,
  options: CheckOptions = {},
  dependencies: CheckDependencies = {},
): Promise<void> {
  const entrypoint = (file
    ? await findQueriesFile(file)
    : options.path ? await findApiFileForPath(options.path) : await findQueriesFile())
    ?? fail('Could not find a hypequery API file to check.', [
      'Pass it explicitly: hypequery check ./analytics/api.ts',
    ]);
  const database = await resolveDatasetsDatabase(options.database, 'check');

  let api: unknown;
  try {
    api = await (dependencies.loadApi ?? loadApiModule)(entrypoint);
  } catch (error) {
    // createAPI refuses datasets its engine can't run, so this includes them.
    fail(`${path.relative(process.cwd(), entrypoint)} failed to load: ${error instanceof Error ? error.message : String(error)}`);
  }
  const source = readServeMcpSource(api)
    ?? fail(`${path.relative(process.cwd(), entrypoint)} does not register any datasets.`, [
      'defineServe({ queryBuilder: db, datasets: { orders: Orders } })',
    ]);
  const datasets = source.datasets as Record<string, CheckableDataset>;
  if (Object.keys(datasets).length === 0) fail('No datasets to check.');

  const client = source.resolveAnalytics() as DatasetClientLike;
  const tenant = options.tenant ?? CHECK_TENANT;
  const compile: CompileQuery = (dataset, query) => client.compileDataset(
    dataset,
    query,
    dataset.tenantKey ? { runtime: { tenant: { id: tenant } } } : undefined,
  );

  const engine = database === 'postgres' ? 'Postgres' : 'ClickHouse';
  logger.info(`Planning dataset queries on ${engine} with EXPLAIN (nothing is executed)...`);
  logger.newline();
  const results = await (dependencies.withExplainer ?? withExplainer)(
    database,
    entrypoint,
    (explain) => checkDatasets(datasets, compile, explain),
  );

  let failed = 0;
  for (const result of results) {
    if (result.failures.length === 0) {
      logger.success(`${result.dataset}: ${result.queries} ${result.queries === 1 ? 'query' : 'queries'} planned`);
    } else {
      failed += 1;
      logger.error(`${result.dataset}: ${result.failures.length} failed`);
      for (const failure of result.failures) {
        logger.indent(`${failure.label} (${failure.stage}): ${failure.message}`);
      }
    }
    for (const warning of result.warnings) logger.warn(`${result.dataset}: ${warning}`);
  }
  logger.newline();
  if (failed > 0) {
    logger.error(`${failed} of ${results.length} datasets failed the check.`);
    logger.newline();
    exitWith(1, 'failure', 'validation_failed');
  }
  logger.success(`All ${results.length} datasets plan on ${engine}.`);
}

async function withExplainer(
  database: DatasetsDatabase,
  entrypoint: string,
  work: (explain: ExplainStatement) => Promise<DatasetCheckResult[]>,
): Promise<DatasetCheckResult[]> {
  if (database === 'postgres') {
    const url = postgresUrlFromEnv()
      ?? fail('Postgres connection details are missing. Set DATABASE_URL (or POSTGRES_URL) to a postgres:// URL.');
    return withPostgresClient(url, async (client) => {
      // Planning runs no query, but a misbehaving one still mustn't write or hang.
      await client.query("SELECT set_config('default_transaction_read_only', 'on', false), set_config('statement_timeout', '30000', false)");
      return work(postgresExplainer(client));
    });
  }
  const { substituteParameters } = await importFromProject<{
    substituteParameters: (sql: string, parameters: unknown[]) => string;
  }>('@hypequery/clickhouse', entrypoint, async () => fail(
    'Checking ClickHouse datasets needs @hypequery/clickhouse in the project.',
    ['npm install @hypequery/clickhouse'],
  ));
  const config = getClickHouseConfigFromEnv()
    ?? fail('ClickHouse connection details are missing. Set CLICKHOUSE_URL (or CLICKHOUSE_HOST), CLICKHOUSE_DATABASE, CLICKHOUSE_USERNAME and CLICKHOUSE_PASSWORD.');
  // The check reports each planning error itself; the client's own error log would repeat it.
  const client = createClient({ ...config, log: { level: ClickHouseLogLevel.OFF } });
  try {
    return await work(clickhouseExplainer(client, substituteParameters));
  } finally {
    await client.close();
  }
}
