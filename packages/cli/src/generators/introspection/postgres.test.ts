import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateDatasets } from '../dataset-generator.js';
import {
  postgresIntrospector,
  postgresToDimensionType,
  postgresUrlFromEnv,
  withPostgresClient,
  type PostgresIntrospectionClient,
} from './postgres.js';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');

/** Answers the three catalog queries the introspector issues. */
function catalog(): PostgresIntrospectionClient {
  const tables = [
    { table_schema: 'public', table_name: 'customers' },
    { table_schema: 'public', table_name: 'orders' },
    { table_schema: 'billing', table_name: 'invoices' },
    { table_schema: 'public', table_name: 'weird-name' },
  ];
  const columns: Record<string, { column_name: string; data_type: string }[]> = {
    'public.customers': [
      { column_name: 'id', data_type: 'bigint' },
      { column_name: 'country', data_type: 'text' },
    ],
    'public.orders': [
      { column_name: 'id', data_type: 'bigint' },
      { column_name: 'customer_id', data_type: 'bigint' },
      { column_name: 'createdAt', data_type: 'timestamp with time zone' },
      { column_name: 'amount', data_type: 'numeric' },
      { column_name: 'is_gift', data_type: 'boolean' },
      { column_name: 'status', data_type: 'USER-DEFINED' },
    ],
    'billing.invoices': [
      { column_name: 'id', data_type: 'uuid' },
      { column_name: 'order_id', data_type: 'bigint' },
      { column_name: 'issued_on', data_type: 'date' },
      { column_name: 'total', data_type: 'double precision' },
    ],
  };
  const keys = [
    { source_schema: 'public', source_table: 'orders', source_column: 'customer_id', target_schema: 'public', target_table: 'customers', target_column: 'id' },
    { source_schema: 'billing', source_table: 'invoices', source_column: 'order_id', target_schema: 'public', target_table: 'orders', target_column: 'id' },
    { source_schema: 'public', source_table: 'orders', source_column: 'id', target_schema: 'public', target_table: 'gone', target_column: 'id' },
  ];
  return {
    async query<R>(text: string, values?: unknown[]): Promise<{ rows: R[] }> {
      if (text.includes('information_schema.tables')) return { rows: tables as R[] };
      if (text.includes('information_schema.columns')) return { rows: (columns[`${values![0]}.${values![1]}`] ?? []) as R[] };
      if (text.includes('pg_constraint')) return { rows: keys as R[] };
      throw new Error(`Unexpected query: ${text}`);
    },
  };
}

describe('Postgres dataset generation', () => {
  it('maps information_schema types to dimension types', () => {
    expect(postgresToDimensionType('integer')).toBe('number');
    expect(postgresToDimensionType('double precision')).toBe('number');
    expect(postgresToDimensionType('timestamp without time zone')).toBe('timestamp');
    expect(postgresToDimensionType('date')).toBe('timestamp');
    expect(postgresToDimensionType('boolean')).toBe('boolean');
    expect(postgresToDimensionType('uuid')).toBe('string');
    expect(postgresToDimensionType('USER-DEFINED')).toBe('string');
  });

  it('reads the connection URL only when it is a Postgres URL', () => {
    expect(postgresUrlFromEnv({ DATABASE_URL: 'postgres://h/db' })).toBe('postgres://h/db');
    expect(postgresUrlFromEnv({ POSTGRES_URL: 'postgresql://h/db' })).toBe('postgresql://h/db');
    expect(postgresUrlFromEnv({ DATABASE_URL: 'mysql://h/db' })).toBeUndefined();
  });

  it('generates datasets with foreign-key relationships that type-check', async () => {
    const workdir = await mkdtemp(path.join(tmpdir(), 'hq-postgres-datasets-'));
    const outputPath = path.join(workdir, 'datasets.ts');
    const result = await generateDatasets({ outputPath, introspector: postgresIntrospector(catalog()) });

    expect(result.tables).toEqual(['customers', 'orders', 'billing_invoices']);
    const generated = await readFile(outputPath, 'utf8');
    expect(generated).toContain('based on your Postgres database schema');
    expect(generated).toContain("import { belongsTo, dataset, dimension, measure } from '@hypequery/datasets';");
    expect(generated).toContain("customer: belongsTo(() => CustomersDataset, { from: 'customer_id', to: 'id' }),");
    expect(generated).toContain("order: belongsTo(() => OrdersDataset, { from: 'order_id', to: 'id' }),");
    expect(generated).toContain("export const BillingInvoicesDataset = dataset('billing_invoices', {");
    expect(generated).toContain("  source: 'billing.invoices',");
    expect(generated).toContain("  timeKey: 'createdAt',");
    expect(generated).toContain("createdAt: dimension.timestamp({ label: 'CreatedAt' }),");
    expect(generated).toContain("totalAmount: measure.sum('amount'");
    expect(generated).toContain("isGift: dimension.boolean({ column: 'is_gift'");
    expect(generated).not.toContain('weird-name');
    expect(generated).not.toContain('gone');

    await writeFile(path.join(workdir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext',
        strict: true, skipLibCheck: true, noEmit: true,
        paths: { '@hypequery/datasets': [path.join(repoRoot, 'packages/datasets/src/index.ts')] },
      },
      include: [outputPath],
    }));
    await execFileAsync(path.join(repoRoot, 'packages/cli/node_modules/.bin/tsc'), ['--project', path.join(workdir, 'tsconfig.json')], { cwd: repoRoot });
  }, 30_000);
});

// Runs the real catalog queries: POSTGRES_URL=postgres://postgres@localhost:55432/postgres
const url = process.env.POSTGRES_URL;
describe.skipIf(!url)('Postgres introspection (live)', () => {
  const schema = 'hq_cli_introspect';
  beforeAll(async () => {
    await withPostgresClient(url!, async (client) => {
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`CREATE TABLE ${schema}.customers (id bigint PRIMARY KEY, "countryCode" text, tier text)`);
      await client.query(`CREATE TABLE ${schema}.orders (id bigint PRIMARY KEY, customer_id bigint REFERENCES ${schema}.customers (id),
        "createdAt" timestamptz, amount numeric(12, 2), status text)`);
      await client.query(`CREATE TABLE ${schema}.pairs (a int, b int, PRIMARY KEY (a, b))`);
      await client.query(`CREATE TABLE ${schema}.links (a int, b int, FOREIGN KEY (a, b) REFERENCES ${schema}.pairs (a, b))`);
    });
  });
  afterAll(async () => {
    await withPostgresClient(url!, (client) => client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`));
  });

  it('introspects tables, columns and single-column foreign keys', async () => {
    await withPostgresClient(url!, async (client) => {
      const introspector = postgresIntrospector(client);
      const tables = (await introspector.listTables()).filter((table) => table.source.startsWith(`${schema}.`));
      expect(tables.map((table) => table.name)).toEqual([
        `${schema}_customers`, `${schema}_links`, `${schema}_orders`, `${schema}_pairs`,
      ]);
      const orders = await introspector.describeTable(tables[2]!);
      expect(orders.map((column) => [column.name, column.dimensionType])).toEqual([
        ['id', 'number'], ['customer_id', 'number'], ['createdAt', 'timestamp'], ['amount', 'number'], ['status', 'string'],
      ]);
      const keys = await introspector.foreignKeys!(tables);
      // The composite key from links to pairs is left for a hand-written relationship.
      expect([...keys.entries()]).toEqual([
        [`${schema}_orders`, [{ column: 'customer_id', target: `${schema}_customers`, targetColumn: 'id' }]],
      ]);
    });
  });
});
