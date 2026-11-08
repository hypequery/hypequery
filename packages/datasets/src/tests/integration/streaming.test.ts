import { beforeAll, describe, expect, it } from 'vitest';
import { createQueryBuilder } from '../../../../clickhouse/src/index.js';
import { dataset } from '../../dataset.js';
import { dimension } from '../../field.js';
import { measure } from '../../measure.js';
import { divide, nullIfZero } from '../../formulas.js';
import { createDatasetClient } from '../../executor.js';
import { serializeSemanticMeasureValues } from '../../utils/semantic-result-serialization.js';
import { TEST_CONNECTION_CONFIG, runSql } from '../../../../../testing/clickhouse/harness.mjs';

const db = createQueryBuilder({ host: TEST_CONNECTION_CONFIG.host, username: TEST_CONNECTION_CONFIG.user,
  password: TEST_CONNECTION_CONFIG.password, database: TEST_CONNECTION_CONFIG.database });
const client = createDatasetClient({ queryBuilder: db });

const source = 'streaming_sales';
const definition = {
  source,
  tenantKey: 'tenant',
  dimensions: { status: dimension.string(), customer: dimension.number() },
  measures: {
    revenue: measure.sum('amount'),
    orders: measure.count('customer'),
    buyers: measure.countDistinct('customer'),
    aov: measure.derived({
      uses: { revenue: 'revenue', orders: 'orders' },
      formula: ({ revenue, orders }) => divide(revenue, nullIfZero(orders)),
    }),
  },
};
const Sales = dataset('sales', { ...definition, limits: { maxResultSize: 10_000 } });
const Capped = dataset('capped_sales', { ...definition, limits: { maxResultSize: 100 } });
const totalRevenue = Sales.metric('totalRevenue', { measure: 'revenue' });

const A = { runtime: { tenant: 'a' } };
const B = { runtime: { tenant: 'b' } };
const grouped = {
  dimensions: ['status', 'customer'],
  measures: ['revenue', 'orders', 'buyers'],
  orderBy: [{ field: 'status', direction: 'asc' }, { field: 'customer', direction: 'asc' }],
} as const;

async function rowsOf<T>(stream: ReadableStream<T[]>): Promise<{ rows: T[]; batches: number }> {
  const rows: T[] = [];
  let batches = 0;
  for await (const batch of stream as unknown as AsyncIterable<T[]>) {
    rows.push(...batch);
    batches++;
  }
  return { rows, batches };
}

async function bytesOf(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/** Loads Arrow IPC bytes into a fresh table through ClickHouse's own Arrow reader. */
async function loadArrow(table: string, columns: string, bytes: Buffer): Promise<void> {
  await runSql(`DROP TABLE IF EXISTS ${table}`);
  await runSql(`CREATE TABLE ${table} (${columns}) ENGINE = Memory`);
  const url = new URL('/', TEST_CONNECTION_CONFIG.host);
  url.searchParams.set('user', TEST_CONNECTION_CONFIG.user);
  url.searchParams.set('password', TEST_CONNECTION_CONFIG.password);
  url.searchParams.set('database', TEST_CONNECTION_CONFIG.database);
  url.searchParams.set('query', `INSERT INTO ${table} FORMAT ArrowStream`);
  const response = await fetch(url, { method: 'POST', body: bytes });
  if (!response.ok) throw new Error(await response.text());
}

describe('dataset streams on ClickHouse', () => {
  beforeAll(async () => {
    await runSql(`DROP TABLE IF EXISTS ${source}`);
    await runSql(`CREATE TABLE ${source} (tenant String, status String, customer UInt32, amount Decimal(18, 2)) ENGINE = MergeTree ORDER BY (tenant, customer)`);
    await runSql(`INSERT INTO ${source} SELECT if(number % 2 = 0, 'a', 'b'), ['paid', 'open', 'void', 'refunded', 'held'][intDiv(number, 7) % 5 + 1], number % 1000, toDecimal64((number % 997) / 10, 2) FROM numbers(60000)`);
  });

  it('streams exactly the rows execute() returns', async () => {
    const executed = await client.execute(Sales, grouped, A);
    const streamed = await client.stream(Sales, grouped, A);
    const { rows } = await rowsOf(streamed.data);

    expect(executed.data.length).toBe(2500);
    expect(rows).toEqual(executed.data);
    expect(streamed.meta.tenant).toBe('a');
    expect(streamed.meta.resultLimit).toEqual({ maxResultSize: 10_000, applied: 10_000 });
  });

  it('streams derived measures through the raw-SQL plan', async () => {
    const query = { dimensions: ['status'], measures: ['aov'], orderBy: [{ field: 'status', direction: 'asc' }] } as const;
    const executed = await client.execute(Sales, query, A);
    const { rows } = await rowsOf((await client.stream(Sales, query, A)).data);

    expect(rows).toEqual(executed.data);
  });

  it('streams metrics', async () => {
    const query = { dimensions: ['status'], orderBy: [{ field: 'status', direction: 'asc' }] } as const;
    const executed = await client.execute(totalRevenue, query, A);
    const { rows } = await rowsOf((await client.stream(totalRevenue, query, A)).data);

    expect(rows).toEqual(executed.data);
  });

  it('never streams another tenant', async () => {
    const { rows } = await rowsOf((await client.stream(Sales, grouped, B)).data);

    expect(rows.length).toBe(2500);
    expect(rows.every(row => Number(row.customer) % 2 === 1)).toBe(true);
  });

  it('stops at the dataset ceiling and says so', async () => {
    const streamed = await client.stream(Capped, grouped, A);
    const { rows } = await rowsOf(streamed.data);

    expect(rows).toHaveLength(100);
    expect(streamed.meta.resultLimit).toEqual({ maxResultSize: 100, applied: 100 });

    const arrow = await client.streamArrow(Capped, grouped, A);
    await loadArrow('streaming_capped_arrow', 'status String, customer UInt32, revenue Decimal(38, 2), orders UInt64, buyers UInt64', await bytesOf(arrow.data));
    expect(await db.rawQuery('SELECT count() AS n FROM streaming_capped_arrow')).toEqual([{ n: '100' }]);
  });

  it('streams Arrow that decodes to the same values with native column types', async () => {
    const executed = await client.execute(Sales, grouped, A);
    const arrow = await client.streamArrow(Sales, grouped, A);
    const bytes = await bytesOf(arrow.data);

    // An Arrow IPC stream: each message opens with the 0xFFFFFFFF continuation marker.
    expect(bytes.readUInt32LE(0)).toBe(0xffffffff);
    await loadArrow('streaming_sales_arrow', 'status String, customer UInt32, revenue Decimal(38, 2), orders UInt64, buyers UInt64', bytes);
    const loaded = await db.rawQuery<Record<string, unknown>>(
      'SELECT status, customer, revenue, orders, buyers FROM streaming_sales_arrow ORDER BY status, customer',
    );

    expect(serializeSemanticMeasureValues(loaded, ['revenue', 'orders', 'buyers'])).toEqual(executed.data);
  });
});
