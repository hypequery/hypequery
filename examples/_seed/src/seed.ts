import fs from 'node:fs';
import path from 'node:path';
import type { ClickHouseClient } from '@clickhouse/client';
import { createSeedClient } from './client.js';
import type { SeedConfig } from './config.js';
import { SeedGenerator, DEFAULT_EVENT_COUNT } from './generator.js';
import { splitSqlStatements } from './utils/sql-statements.js';
import {
  computeChecksums,
  diffChecksums,
  type ChecksumFile,
  type SeedTable,
  type TableChecksum,
} from './checksums.js';

const INSERT_BATCH = 50_000;

export interface SeedOptions {
  config: SeedConfig;
  /** Folder holding schema.sql and checksums.json. */
  packageRoot: string;
  eventCount?: number;
  log?: (line: string) => void;
}

export async function recreateDatabase(config: SeedConfig): Promise<void> {
  const admin = createSeedClient(config, 'system');
  try {
    await admin.command({ query: `DROP DATABASE IF EXISTS ${config.database} SYNC` });
    await admin.command({ query: `CREATE DATABASE ${config.database}` });
  } finally {
    await admin.close();
  }
}

export async function applySchema(client: ClickHouseClient, schemaFile: string): Promise<number> {
  const statements = splitSqlStatements(fs.readFileSync(schemaFile, 'utf8'));
  for (const statement of statements) {
    await client.command({ query: statement });
  }
  return statements.length;
}

async function insertRows(client: ClickHouseClient, table: string, rows: object[]): Promise<void> {
  if (rows.length === 0) return;
  await client.insert({ table, values: rows, format: 'JSONEachRow' });
}

export async function loadData(client: ClickHouseClient, generator: SeedGenerator, log: (line: string) => void): Promise<void> {
  await insertRows(client, 'tenants', generator.tenantRows());
  log(`tenants: ${generator.tenants.length} rows`);
  await insertRows(client, 'users', generator.userRows());
  log(`users: ${generator.users.length} rows`);

  let batch: object[] = [];
  let inserted = 0;
  for (const event of generator.events()) {
    batch.push(event);
    if (batch.length === INSERT_BATCH) {
      await insertRows(client, 'events', batch);
      inserted += batch.length;
      log(`events: ${inserted}/${generator.eventCount} rows`);
      batch = [];
    }
  }
  await insertRows(client, 'events', batch);
  inserted += batch.length;
  log(`events: ${inserted}/${generator.eventCount} rows`);

  const subscriptions = generator.subscriptionRows();
  await insertRows(client, 'subscriptions', subscriptions);
  log(`subscriptions: ${subscriptions.length} rows`);
}

export function readChecksumFile(packageRoot: string): ChecksumFile | null {
  const file = path.join(packageRoot, 'checksums.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8')) as ChecksumFile;
}

export function writeChecksumFile(packageRoot: string, data: ChecksumFile): void {
  fs.writeFileSync(path.join(packageRoot, 'checksums.json'), `${JSON.stringify(data, null, 2)}\n`);
}

export async function clickhouseVersion(client: ClickHouseClient): Promise<string> {
  const rs = await client.query({ query: 'SELECT version() AS v', format: 'JSONEachRow' });
  const [row] = await rs.json<{ v: string }>();
  return row.v;
}

/** Drop, recreate, load. Returns the checksums of what was loaded. */
export async function seed(options: SeedOptions): Promise<Record<SeedTable, TableChecksum>> {
  const log = options.log ?? (() => {});
  const eventCount = options.eventCount ?? DEFAULT_EVENT_COUNT;
  await recreateDatabase(options.config);
  const client = createSeedClient(options.config);
  try {
    const applied = await applySchema(client, path.join(options.packageRoot, 'schema.sql'));
    log(`schema: ${applied} statements applied to ${options.config.database}`);
    const generator = new SeedGenerator(eventCount);
    await loadData(client, generator, log);
    return computeChecksums(client, options.config.database);
  } finally {
    await client.close();
  }
}

/** Compare the live database against checksums.json; throws on mismatch. */
export async function verify(options: SeedOptions, actual?: Record<SeedTable, TableChecksum>): Promise<void> {
  const expected = readChecksumFile(options.packageRoot);
  if (!expected) {
    throw new Error('checksums.json is missing; run with --write-checksums to create it');
  }
  const eventCount = options.eventCount ?? DEFAULT_EVENT_COUNT;
  if (expected.eventCount !== eventCount) {
    throw new Error(`checksums.json was produced with ${expected.eventCount} events, not ${eventCount}`);
  }
  let live = actual;
  if (!live) {
    const client = createSeedClient(options.config);
    try {
      live = await computeChecksums(client, options.config.database);
    } finally {
      await client.close();
    }
  }
  const mismatches = diffChecksums(expected.tables, live);
  if (mismatches.length > 0) {
    const detail = mismatches
      .map((m) => `  ${m.table}: expected ${m.expected?.rows} rows / ${m.expected?.checksum}, got ${m.actual?.rows} rows / ${m.actual?.checksum}`)
      .join('\n');
    throw new Error(`Seed checksums do not match checksums.json:\n${detail}\n\nIf the generator or schema changed on purpose, run: pnpm --filter @hypequery-examples/seed seed:write-checksums`);
  }
}
