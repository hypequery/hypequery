import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createClient, type ClickHouseClient } from '@clickhouse/client';
import {
  buildPulledSchemaAst,
  renderPulledSchemaSource,
  serializeSchemaToSnapshot,
  snapshotToStableJson,
  type IntrospectedColumnRow,
  type IntrospectedTableRow,
} from '@hypequery/clickhouse';
import { logger } from '../utils/logger.js';
import { loadHypequeryConfig } from '../utils/load-hypequery-config.js';
import { writeMigrationJournal, type MigrationJournal } from '../utils/migration-state.js';
import ora from 'ora';

export interface PullOptions {
  config?: string;
  force?: boolean;
}

export async function pullCommand(options: PullOptions = {}): Promise<void> {
  logger.command('pull', 'Baseline a live ClickHouse schema into managed migration files.');
  logger.phase('Preparing baseline targets');

  const spinner = ora('Loading hypequery config...').start();
  let client: ClickHouseClient | null = null;

  try {
    const config = await loadHypequeryConfig(options.config);
    const schemaPath = path.resolve(process.cwd(), config.schema);
    const migrationsOutDir = path.resolve(process.cwd(), config.migrations.out);
    const metaDir = path.join(migrationsOutDir, 'meta');
    const snapshotPath = path.join(metaDir, '0000_snapshot.json');
    const journalPath = path.join(metaDir, '_journal.json');

    await assertPullTargetsWritable({
      force: options.force === true,
      schemaPath,
      snapshotPath,
      journalPath,
    });

    logger.phase('Connecting to ClickHouse');
    spinner.text = 'Connecting to ClickHouse...';
    client = createClient({
      url: toClickHouseUrl(config.dbCredentials),
      username: config.dbCredentials.username,
      password: config.dbCredentials.password ?? '',
      database: config.dbCredentials.database,
    });

    logger.phase('Inspecting live schema');
    spinner.text = 'Introspecting live schema...';
    const tables = await fetchManagedTables(client, config.dbCredentials.database);
    const columns = await fetchColumns(client, config.dbCredentials.database);
    const materializedViewCount = await countMaterializedViews(client, config.dbCredentials.database);
    const schema = buildPulledSchemaAst(tables, columns);
    const snapshot = serializeSchemaToSnapshot(schema);
    const schemaSource = renderPulledSchemaSource(schema, {
      database: config.dbCredentials.database,
      materializedViewCount,
    });

    logger.phase('Writing baseline files');
    spinner.text = 'Writing baseline files...';
    await mkdir(path.dirname(schemaPath), { recursive: true });
    await mkdir(metaDir, { recursive: true });
    await writeFile(schemaPath, schemaSource, 'utf8');
    await writeFile(snapshotPath, `${snapshotToStableJson(snapshot)}\n`, 'utf8');

    const journal: MigrationJournal = {
      version: 1,
      latestSnapshotPath: '0000_snapshot.json',
      snapshots: [
        {
          path: '0000_snapshot.json',
          source: 'baseline',
          createdAt: new Date().toISOString(),
          snapshotHash: snapshot.contentHash,
        },
      ],
      migrations: [],
    };
    await writeMigrationJournal(metaDir, journal);

    spinner.succeed('Pulled baseline schema from ClickHouse');
    logger.kv([
      ['schema', path.relative(process.cwd(), schemaPath)],
      ['snapshot', path.relative(process.cwd(), snapshotPath)],
      ['journal', path.relative(process.cwd(), journalPath)],
      ['tables', String(tables.length)],
    ]);

    if (materializedViewCount > 0) {
      logger.callout('Follow-up', [
        `Skipped ${materializedViewCount} materialized view` +
          `${materializedViewCount === 1 ? '' : 's'} during baseline emission.`,
        'Materialized view emission still requires a later manual follow-up step.',
      ]);
    }
  } catch (error) {
    spinner.fail('Failed to pull schema baseline');
    logger.newline();
    logger.error(error instanceof Error ? error.message : String(error));
    logger.newline();
    process.exit(1);
  } finally {
    await client?.close().catch(() => undefined);
  }
}

async function assertPullTargetsWritable(input: {
  force: boolean;
  schemaPath: string;
  snapshotPath: string;
  journalPath: string;
}) {
  if (input.force) {
    return;
  }

  for (const filePath of [input.schemaPath, input.snapshotPath, input.journalPath]) {
    if (await pathExists(filePath)) {
      throw new Error(
        `Refusing to overwrite existing file: ${path.relative(process.cwd(), filePath)}\n\n` +
        `Re-run with --force to replace the existing baseline files.`,
      );
    }
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function fetchManagedTables(
  client: ClickHouseClient,
  database: string,
): Promise<IntrospectedTableRow[]> {
  const result = await client.query({
    query: `
      SELECT
        name,
        engine,
        partition_key AS partitionKey,
        sorting_key AS sortingKey,
        primary_key AS primaryKey,
        sampling_key AS samplingKey
      FROM system.tables
      WHERE database = {database:String}
        AND engine != 'MaterializedView'
      ORDER BY name
    `,
    query_params: {
      database,
    },
    format: 'JSONEachRow',
  });

  return (await result.json()) as IntrospectedTableRow[];
}

async function fetchColumns(
  client: ClickHouseClient,
  database: string,
): Promise<IntrospectedColumnRow[]> {
  const result = await client.query({
    query: `
      SELECT
        table,
        name,
        type,
        default_kind AS defaultKind,
        default_expression AS defaultExpression,
        position
      FROM system.columns
      WHERE database = {database:String}
      ORDER BY table, position
    `,
    query_params: {
      database,
    },
    format: 'JSONEachRow',
  });

  return (await result.json()) as IntrospectedColumnRow[];
}

async function countMaterializedViews(
  client: ClickHouseClient,
  database: string,
): Promise<number> {
  const result = await client.query({
    query: `
      SELECT count() AS count
      FROM system.tables
      WHERE database = {database:String}
        AND engine = 'MaterializedView'
    `,
    query_params: {
      database,
    },
    format: 'JSONEachRow',
  });

  const rows = (await result.json()) as Array<{ count: number | string }>;
  return Number(rows[0]?.count ?? 0);
}

function toClickHouseUrl(credentials: {
  host: string;
  port?: number;
  secure?: boolean;
}): string {
  if (/^https?:\/\//i.test(credentials.host)) {
    return credentials.host;
  }

  const protocol = credentials.secure ? 'https' : 'http';
  const port = credentials.port ?? (credentials.secure ? 8443 : 8123);
  return `${protocol}://${credentials.host}:${port}`;
}
