import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ClickHouseClient } from '@clickhouse/client';
import type { MigrationJournalEntry } from './migration-state.js';

export interface LoadedMigrationFiles {
  migrationName: string;
  migrationDir: string;
  upSql: string;
  downSql: string | null;
  metaJson: string;
  planJson: string | null;
  checksum: string;
  kind: 'generated' | 'custom';
}

export interface AppliedMigrationStatusRow {
  migration_name: string;
  checksum: string;
  status: string;
}

export async function loadMigrationFiles(
  migrationsOutDir: string,
  entry: MigrationJournalEntry,
): Promise<LoadedMigrationFiles> {
  const migrationDir = path.join(migrationsOutDir, entry.name);
  const upPath = path.join(migrationDir, 'up.sql');
  const downPath = path.join(migrationDir, 'down.sql');
  const metaPath = path.join(migrationDir, 'meta.json');
  const planPath = path.join(migrationDir, 'plan.json');

  const upSql = await readFile(upPath, 'utf8');
  const metaJson = await readFile(metaPath, 'utf8');
  const downSql = await readOptionalFile(downPath);
  const planJson = await readOptionalFile(planPath);

  return {
    migrationName: entry.name,
    migrationDir,
    upSql,
    downSql,
    metaJson,
    planJson,
    checksum: computeMigrationChecksum({
      upSql,
      downSql,
      metaJson,
      planJson,
    }),
    kind: entry.kind,
  };
}

export async function loadMigrationFilesBatch(
  migrationsOutDir: string,
  entries: MigrationJournalEntry[],
): Promise<LoadedMigrationFiles[]> {
  const loaded: LoadedMigrationFiles[] = [];

  for (const entry of entries) {
    loaded.push(await loadMigrationFiles(migrationsOutDir, entry));
  }

  return loaded;
}

export async function tryLoadAppliedMigrationStatuses(
  client: ClickHouseClient,
  tableName: string,
): Promise<Map<string, AppliedMigrationStatusRow> | null> {
  try {
    const result = await client.query({
      query: `
        SELECT migration_name, checksum, status
        FROM ${quoteIdentifier(tableName)}
        ORDER BY started_at
      `,
      format: 'JSONEachRow',
    });

    const rows = (await result.json()) as AppliedMigrationStatusRow[];
    const byMigration = new Map<string, AppliedMigrationStatusRow>();

    for (const row of rows) {
      byMigration.set(row.migration_name, row);
    }

    return byMigration;
  } catch (error: any) {
    const message = String(error?.message ?? error);
    if (message.includes('UNKNOWN_TABLE') || message.includes('doesn\'t exist')) {
      return null;
    }

    throw error;
  }
}

export function computeMigrationChecksum(input: {
  upSql: string;
  downSql: string | null;
  metaJson: string;
  planJson: string | null;
}): string {
  const parts = [
    `up.sql:${input.upSql}`,
    `down.sql:${input.downSql ?? ''}`,
    `meta.json:${input.metaJson}`,
    `plan.json:${input.planJson ?? ''}`,
  ];
  return hashContent(parts.join('\n---\n'));
}

export async function readOptionalFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export function toClickHouseUrl(credentials: {
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

export function quoteIdentifier(identifier: string): string {
  return `\`${identifier.replace(/`/g, '``')}\``;
}

export function hashContent(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
