import type { ClickHouseClient } from '@clickhouse/client';

export const SEED_TABLES = ['tenants', 'users', 'events', 'subscriptions'] as const;
export type SeedTable = (typeof SEED_TABLES)[number];

export interface TableChecksum {
  rows: number;
  /** `sum(cityHash64(*))` as a decimal string (UInt64 wraps, which is fine). */
  checksum: string;
}

export interface ChecksumFile {
  /** ClickHouse server version the checksums were produced on. */
  clickhouse: string;
  eventCount: number;
  tables: Record<SeedTable, TableChecksum>;
}

export async function computeChecksums(client: ClickHouseClient, database: string): Promise<Record<SeedTable, TableChecksum>> {
  const result = {} as Record<SeedTable, TableChecksum>;
  for (const table of SEED_TABLES) {
    const rs = await client.query({
      query: `SELECT toUInt64(count()) AS rows, toString(sum(cityHash64(*))) AS checksum FROM ${database}.${table}`,
      format: 'JSONEachRow',
    });
    const [row] = await rs.json<{ rows: string | number; checksum: string }>();
    result[table] = { rows: Number(row.rows), checksum: row.checksum };
  }
  return result;
}

export interface ChecksumMismatch {
  table: SeedTable;
  expected: TableChecksum | undefined;
  actual: TableChecksum | undefined;
}

export function diffChecksums(
  expected: Record<SeedTable, TableChecksum>,
  actual: Record<SeedTable, TableChecksum>,
): ChecksumMismatch[] {
  const mismatches: ChecksumMismatch[] = [];
  for (const table of SEED_TABLES) {
    const e = expected[table];
    const a = actual[table];
    if (!e || !a || e.rows !== a.rows || e.checksum !== a.checksum) {
      mismatches.push({ table, expected: e, actual: a });
    }
  }
  return mismatches;
}

export function formatChecksumTable(checksums: Record<SeedTable, TableChecksum>): string {
  const lines = ['table          rows      checksum'];
  for (const table of SEED_TABLES) {
    const { rows, checksum } = checksums[table];
    lines.push(`${table.padEnd(14)} ${String(rows).padStart(9)} ${checksum}`);
  }
  return lines.join('\n');
}
