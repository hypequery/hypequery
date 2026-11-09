import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateDatasets } from './dataset-generator.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TSC_TIMEOUT_MS = 30_000;

const mockQuery = vi.fn();

vi.mock('../utils/clickhouse-client.js', () => ({
  getClickHouseClient: () => ({
    query: mockQuery,
  }),
}));

describe('generateDatasets', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('generates dataset code that type-checks against the public datasets API', async () => {
    mockQuery.mockImplementation(async ({ query }: { query: string }) => {
      if (query === 'SHOW TABLES') {
        return {
          json: async () => [{ name: 'orders' }],
        };
      }

      if (query === 'DESCRIBE TABLE orders') {
        return {
          json: async () => [
            { name: 'id', type: 'UInt64', default_type: '', default_expression: '' },
            { name: 'tenant_id', type: 'String', default_type: '', default_expression: '' },
            { name: 'product_id', type: 'UInt64', default_type: '', default_expression: '' },
            { name: 'trip_id', type: 'UInt64', default_type: '', default_expression: '' },
            { name: 'created_at', type: 'DateTime', default_type: '', default_expression: '' },
            { name: 'latitude', type: 'Float64', default_type: '', default_expression: '' },
            { name: 'longitude', type: 'Float64', default_type: '', default_expression: '' },
            { name: 'amount', type: 'Float64', default_type: '', default_expression: '' },
            { name: 'duration_seconds', type: 'UInt32', default_type: '', default_expression: '' },
            { name: 'payment_type', type: "Enum8('card' = 1, 'cash' = 2)", default_type: '', default_expression: '' },
            { name: 'status', type: 'LowCardinality(String)', default_type: '', default_expression: '' },
            { name: 'pickup_point', type: 'Point', default_type: '', default_expression: '' },
            { name: 'item_counts', type: 'Array(Int32)', default_type: '', default_expression: '' },
            { name: 'tags', type: 'Array(LowCardinality(String))', default_type: '', default_expression: '' },
            { name: 'attrs', type: 'Map(String, UInt64)', default_type: '', default_expression: '' },
            { name: 'route', type: 'Tuple(Float64, Float64)', default_type: '', default_expression: '' },
            {
              name: 'geo',
              type: 'Tuple(country LowCardinality(String), lat Float64, cells Array(UInt64))',
              default_type: '',
              default_expression: '',
            },
            {
              name: 'events',
              type: 'Array(Tuple(\n    kind String,\n    at DateTime))',
              default_type: '',
              default_expression: '',
            },
            // Each of these is spelled like another field once camelCased.
            { name: 'geo_country', type: 'String', default_type: '', default_expression: '' },
            { name: 'fare_total', type: 'Float64', default_type: '', default_expression: '' },
            { name: 'fareTotal', type: 'Float64', default_type: '', default_expression: '' },
          ],
        };
      }

      throw new Error(`Unexpected query: ${query}`);
    });

    const workdir = await mkdtemp(path.join(tmpdir(), 'hq-dataset-generator-'));
    const outputPath = path.join(workdir, 'generated.ts');
    const tsconfigPath = path.join(workdir, 'tsconfig.json');
    const repoRoot = path.resolve(__dirname, '../../../..');

    const result = await generateDatasets({ outputPath });

    const generated = await readFile(outputPath, 'utf8');
    expect(result.contents).toBe(generated);
    expect(generated).toContain("totalCount: measure.count('id'");
    expect(generated).toContain("totalAmount: measure.sum('amount'");
    expect(generated).toContain("avgAmount: measure.avg('amount'");
    expect(generated).toContain("totalDurationSeconds: measure.sum('durationSeconds'");
    expect(generated).toContain("avgDurationSeconds: measure.avg('durationSeconds'");
    expect(generated).toContain("paymentType: dimension.string({ column: 'payment_type'");
    expect(generated).toContain("status: dimension.string({ label: 'Status' })");
    expect(generated).toContain("// Possible tenant key: 'tenant_id'.");
    expect(generated).not.toContain("tenantKey: 'tenant_id'");
    expect(generated).not.toContain("totalProductId: measure.sum('productId'");
    expect(generated).not.toContain("avgProductId: measure.avg('productId'");
    expect(generated).not.toContain("totalTripId: measure.sum('tripId'");
    expect(generated).not.toContain("avgTripId: measure.avg('tripId'");
    expect(generated).not.toContain("totalLatitude: measure.sum('latitude'");
    expect(generated).not.toContain("avgLatitude: measure.avg('latitude'");
    expect(generated).not.toContain("totalLongitude: measure.sum('longitude'");
    expect(generated).not.toContain("avgLongitude: measure.avg('longitude'");
    expect(generated).not.toContain("PaymentType measures");
    expect(generated).not.toContain('measure.count({');
    // A column keeps its natural name over a tuple element, wherever it appears.
    expect(generated).toContain("geoCountry: dimension.string({ column: 'geo_country', label: 'Geo Country' })");
    expect(generated).toContain('// geo.country is geoCountry2: geoCountry is taken by another field or column.');
    expect(generated).toContain(
      `geoCountry2: dimension.string({ sql: "tupleElement(geo, 'country')", dependencies: ['geo'], label: 'Geo Country' })`,
    );
    // A field name is a SQL alias: `fare_total` may not take the name of the real
    // `fareTotal` column, or every expression reading fareTotal would read fare_total.
    expect(generated).toContain("fareTotal: dimension.number({ label: 'FareTotal' })");
    expect(generated).toContain('// fare_total is fareTotal2: fareTotal is taken by another field or column.');
    expect(generated).toContain("fareTotal2: dimension.number({ column: 'fare_total', label: 'Fare Total' })");
    expect(generated).toContain("totalFareTotal: measure.sum('fareTotal'");
    expect(generated).toContain("totalFareTotal2: measure.sum('fareTotal2'");
    expect(generated).toContain(
      `geoLat: dimension.number({ sql: "tupleElement(geo, 'lat')", dependencies: ['geo'], label: 'Geo Lat' })`,
    );
    expect(generated).not.toContain('geoCells');
    for (const [column, type] of [
      ['pickup_point', 'Point'],
      ['item_counts', 'Array(Int32)'],
      ['tags', 'Array(LowCardinality(String))'],
      ['attrs', 'Map(String, UInt64)'],
      ['route', 'Tuple(Float64, Float64)'],
    ]) {
      expect(generated).toContain(`// ${column} (${type}) is not included: no dimension type describes its values.`);
    }
    expect(generated).toContain(
      '// events (Array(Tuple( kind String, at DateTime))) is not included: no dimension type describes its values.',
    );
    expect(generated).not.toMatch(/(?:pickupPoint|itemCounts|tags|attrs|route): dimension\./);
    expect(generated).not.toContain('PickupPoint measures');
    expect(generated).not.toContain('ItemCounts measures');

    await writeFile(
      tsconfigPath,
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          skipLibCheck: true,
          noEmit: true,
          paths: {
            '@hypequery/datasets': [path.join(repoRoot, 'packages/datasets/src/index.ts')],
          },
        },
        include: [outputPath],
      }, null, 2),
    );

    await execFileAsync(
      path.join(repoRoot, 'packages/cli/node_modules/.bin/tsc'),
      ['--project', tsconfigPath],
      { cwd: repoRoot },
    );
  }, TSC_TIMEOUT_MS);

  it('uses an injected introspection client', async () => {
    const injectedQuery = vi.fn(async ({ query }: { query: string }) => {
      if (query === 'SHOW TABLES') {
        return { json: async () => [{ name: 'events' }] };
      }
      if (query === 'DESCRIBE TABLE events') {
        return {
          json: async () => [
            { name: 'id', type: 'UInt64', default_type: '', default_expression: '' },
          ],
        };
      }
      throw new Error(`Unexpected query: ${query}`);
    });
    const workdir = await mkdtemp(path.join(tmpdir(), 'hq-dataset-client-'));
    const outputPath = path.join(workdir, 'datasets.ts');

    await generateDatasets({
      outputPath,
      client: { query: injectedQuery },
    });

    expect(injectedQuery).toHaveBeenCalledWith({
      query: 'SHOW TABLES',
      format: 'JSONEachRow',
    });
    await expect(readFile(outputPath, 'utf8')).resolves.toContain(
      "export const EventsDataset = dataset('events'",
    );
  });

  it('can render definitions without writing the output file', async () => {
    const injectedQuery = vi.fn(async ({ query }: { query: string }) => {
      if (query === 'SHOW TABLES') {
        return { json: async () => [{ name: 'events' }] };
      }
      if (query === 'DESCRIBE TABLE events') {
        return {
          json: async () => [
            { name: 'id', type: 'UInt64', default_type: '', default_expression: '' },
          ],
        };
      }
      throw new Error(`Unexpected query: ${query}`);
    });
    const workdir = await mkdtemp(path.join(tmpdir(), 'hq-dataset-render-only-'));
    const outputPath = path.join(workdir, 'datasets.ts');

    const result = await generateDatasets({
      outputPath,
      client: { query: injectedQuery },
      writeOutput: false,
    });

    expect(result.contents).toContain("export const EventsDataset = dataset('events'");
    await expect(readFile(outputPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('counts and keys time only on columns that become dimensions', async () => {
    const injectedQuery = vi.fn(async ({ query }: { query: string }) => {
      if (query === 'SHOW TABLES') {
        return { json: async () => [{ name: 'events' }] };
      }
      if (query === 'DESCRIBE TABLE events') {
        return {
          json: async () => [
            { name: 'seen_dates', type: 'Array(Date)', default_type: '', default_expression: '' },
            { name: 'created', type: 'String', default_type: '', default_expression: '' },
            { name: 'name', type: 'String', default_type: '', default_expression: '' },
          ],
        };
      }
      throw new Error(`Unexpected query: ${query}`);
    });

    const result = await generateDatasets({
      outputPath: 'unused.ts',
      client: { query: injectedQuery },
      writeOutput: false,
    });

    expect(result.contents).toContain("totalCount: measure.count('created'");
    expect(result.contents).not.toContain('timeKey:');
  });

  it('gives measures distinct names that shadow no column', async () => {
    const injectedQuery = vi.fn(async ({ query }: { query: string }) => {
      if (query === 'SHOW TABLES') {
        return { json: async () => [{ name: 'events' }] };
      }
      if (query === 'DESCRIBE TABLE events') {
        return {
          json: async () => [
            { name: 'name', type: 'String', default_type: '', default_expression: '' },
            { name: 'count', type: 'UInt32', default_type: '', default_expression: '' },
            { name: 'fare', type: 'Float64', default_type: '', default_expression: '' },
            { name: 'Fare', type: 'Float64', default_type: '', default_expression: '' },
            { name: 'avgFare', type: 'Float64', default_type: '', default_expression: '' },
          ],
        };
      }
      throw new Error(`Unexpected query: ${query}`);
    });

    const { contents } = await generateDatasets({
      outputPath: 'unused.ts',
      client: { query: injectedQuery },
      writeOutput: false,
    });

    expect(contents).toContain("totalCount: measure.count('name'");
    expect(contents).toContain("totalCount2: measure.sum('count'");
    expect(contents).toContain("totalFare: measure.sum('fare'");
    // The real avgFare column keeps its name, so the measure over fare moves aside.
    expect(contents).toContain("avgFare2: measure.avg('fare'");
    expect(contents).toContain("totalFare2: measure.sum('Fare'");
    expect(contents).toContain("avgFare3: measure.avg('Fare'");
    const keys = [...contents.matchAll(/^ {4}(\w+):/gm)].map((match) => match[1]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('never turns customer_id naming into active tenant enforcement', async () => {
    mockQuery.mockImplementation(async ({ query }: { query: string }) => {
      if (query === 'SHOW TABLES') {
        return { json: async () => [{ name: 'orders' }] };
      }
      if (query === 'DESCRIBE TABLE orders') {
        return {
          json: async () => [
            { name: 'id', type: 'UInt64', default_type: '', default_expression: '' },
            { name: 'customer_id', type: 'UInt64', default_type: '', default_expression: '' },
          ],
        };
      }
      throw new Error(`Unexpected query: ${query}`);
    });
    const workdir = await mkdtemp(path.join(tmpdir(), 'hq-dataset-tenant-candidate-'));
    const outputPath = path.join(workdir, 'datasets.ts');

    const result = await generateDatasets({ outputPath });
    const generated = await readFile(outputPath, 'utf8');

    expect(generated).toContain("// Possible tenant key: 'customer_id'.");
    expect(generated).not.toContain("tenantKey: 'customer_id'");
    expect(result.warnings).toEqual([
      expect.objectContaining({
        kind: 'tenant-key-candidate',
        table: 'orders',
        columns: ['customer_id'],
      }),
    ]);
  });

  it('reports every tenant-key candidate, not just the first', async () => {
    mockQuery.mockImplementation(async ({ query }: { query: string }) => {
      if (query === 'SHOW TABLES') {
        return { json: async () => [{ name: 'orders' }] };
      }
      if (query === 'DESCRIBE TABLE orders') {
        return {
          json: async () => [
            { name: 'id', type: 'UInt64', default_type: '', default_expression: '' },
            { name: 'organization_id', type: 'String', default_type: '', default_expression: '' },
            { name: 'customer_id', type: 'UInt64', default_type: '', default_expression: '' },
          ],
        };
      }
      throw new Error(`Unexpected query: ${query}`);
    });
    const workdir = await mkdtemp(path.join(tmpdir(), 'hq-dataset-tenant-multi-'));
    const outputPath = path.join(workdir, 'datasets.ts');

    const result = await generateDatasets({ outputPath });
    const generated = await readFile(outputPath, 'utf8');

    expect(generated).toContain("// Possible tenant keys: 'organization_id', 'customer_id'.");
    expect(result.warnings).toEqual([
      expect.objectContaining({
        kind: 'tenant-key-candidate',
        table: 'orders',
        columns: ['organization_id', 'customer_id'],
      }),
    ]);
    expect(result.warnings[0].message).toContain('"organization_id", "customer_id"');
  });

  it('applies an explicitly configured tenant column', async () => {
    mockQuery.mockImplementation(async ({ query }: { query: string }) => {
      if (query === 'SHOW TABLES') {
        return { json: async () => [{ name: 'orders' }, { name: 'lookups' }] };
      }
      if (query === 'DESCRIBE TABLE orders') {
        return {
          json: async () => [
            { name: 'id', type: 'UInt64', default_type: '', default_expression: '' },
            { name: 'tenant_id', type: 'String', default_type: '', default_expression: '' },
          ],
        };
      }
      if (query === 'DESCRIBE TABLE lookups') {
        return {
          json: async () => [
            { name: 'id', type: 'UInt64', default_type: '', default_expression: '' },
          ],
        };
      }
      throw new Error(`Unexpected query: ${query}`);
    });
    const workdir = await mkdtemp(path.join(tmpdir(), 'hq-dataset-tenant-column-'));
    const outputPath = path.join(workdir, 'datasets.ts');

    const result = await generateDatasets({ outputPath, tenantColumn: 'tenant_id' });
    const generated = await readFile(outputPath, 'utf8');

    // The configured column becomes real policy; the table missing it is flagged
    // rather than silently left unscoped.
    expect(generated).toContain("tenantKey: 'tenant_id',");
    expect(generated).not.toContain('// Possible tenant key');
    expect(result.warnings).toEqual([
      expect.objectContaining({
        kind: 'tenant-column-missing',
        table: 'lookups',
        column: 'tenant_id',
      }),
    ]);
  });

  it('reads versioned and pre-aggregated engines the way ClickHouse stores them', async () => {
    const columns: Record<string, Array<{ name: string; type: string }>> = {
      orders: [
        { name: 'id', type: 'UInt64' },
        { name: 'status', type: 'LowCardinality(String)' },
        { name: 'amount', type: 'Decimal(12, 2)' },
        { name: 'created_at', type: 'DateTime' },
        { name: 'version', type: 'UInt32' },
        { name: 'is_deleted', type: 'UInt8' },
      ],
      sessions: [
        { name: 'session_id', type: 'String' },
        { name: 'duration', type: 'UInt32' },
        { name: 'sign', type: 'Int8' },
      ],
      daily_rollup: [
        { name: 'day', type: 'Date' },
        { name: 'orders', type: 'AggregateFunction(count)' },
        { name: 'revenue_cents', type: 'AggregateFunction(sum, UInt64)' },
        { name: 'buyers', type: 'AggregateFunction(uniq, UInt64)' },
        { name: 'p90_latency', type: 'AggregateFunction(quantile(0.9), Float64)' },
        { name: 'peak_amount', type: 'SimpleAggregateFunction(max, Float64)' },
        { name: 'last_status', type: 'SimpleAggregateFunction(anyLast, String)' },
        // Named like a coordinate, but the declared function says how to read it.
        { name: 'latitude', type: 'SimpleAggregateFunction(max, Float64)' },
        // min/max read timestamps too.
        { name: 'latest_at', type: 'SimpleAggregateFunction(max, DateTime)' },
      ],
      daily_totals: [
        { name: 'day', type: 'Date' },
        { name: 'amount', type: 'Float64' },
        { name: 'tax', type: 'Float64' },
      ],
      events: [
        { name: 'id', type: 'UInt64' },
        { name: 'value', type: 'Float64' },
      ],
      priority_totals: [
        { name: 'day', type: 'Date' },
        { name: 'priority', type: 'UInt8' },
        { name: 'amount', type: 'Float64' },
      ],
    };
    const engines = [
      { name: 'orders', engine: 'SharedReplacingMergeTree', engine_full: "SharedReplacingMergeTree('/clickhouse/{uuid}/{shard}', '{replica}', version, is_deleted) ORDER BY id", sorting_key: 'id' },
      { name: 'sessions', engine: 'CollapsingMergeTree', engine_full: 'CollapsingMergeTree(sign) ORDER BY session_id', sorting_key: 'session_id' },
      { name: 'daily_rollup', engine: 'AggregatingMergeTree', engine_full: 'AggregatingMergeTree ORDER BY day', sorting_key: 'day' },
      { name: 'daily_totals', engine: 'SummingMergeTree', engine_full: 'SummingMergeTree(amount) ORDER BY day', sorting_key: 'day' },
      { name: 'events', engine: 'MergeTree', engine_full: 'MergeTree ORDER BY id', sorting_key: 'id' },
      { name: 'priority_totals', engine: 'SummingMergeTree', engine_full: 'SummingMergeTree ORDER BY (day, priority)', sorting_key: 'day, priority' },
    ];
    const injectedQuery = vi.fn(async ({ query }: { query: string }) => {
      if (query === 'SHOW TABLES') {
        return { json: async () => Object.keys(columns).map((name) => ({ name })) };
      }
      if (query.startsWith('SELECT name, engine, engine_full, sorting_key FROM system.tables')) {
        return { json: async () => engines };
      }
      const table = /^DESCRIBE TABLE (\w+)$/.exec(query)?.[1];
      if (table && columns[table]) {
        return {
          json: async () => columns[table]!.map((column) => ({ ...column, default_type: '', default_expression: '' })),
        };
      }
      throw new Error(`Unexpected query: ${query}`);
    });
    const workdir = await mkdtemp(path.join(tmpdir(), 'hq-dataset-engines-'));
    const outputPath = path.join(workdir, 'generated.ts');
    const tsconfigPath = path.join(workdir, 'tsconfig.json');
    const repoRoot = path.resolve(__dirname, '../../../..');

    const { contents } = await generateDatasets({ outputPath, client: { query: injectedQuery } });
    const section = (table: string) => {
      const start = contents.indexOf(`dataset('${table}'`);
      return contents.slice(start, contents.indexOf('});', start));
    };

    // Versioned engines read with FINAL; their bookkeeping columns are never summed.
    const orders = section('orders');
    expect(orders).toContain("rowResolution: { kind: 'final', engine: 'replacing', deletedColumn: 'is_deleted' },");
    expect(orders).toContain("totalCount: measure.count('id'");
    expect(orders).toContain("totalAmount: measure.sum('amount'");
    expect(orders).not.toMatch(/measure\.\w+\('(?:version|isDeleted)'/);
    const sessions = section('sessions');
    expect(sessions).toContain("rowResolution: { kind: 'final', engine: 'collapsing', signColumn: 'sign' },");
    expect(sessions).toContain("totalDuration: measure.sum('duration'");
    expect(sessions).not.toMatch(/measure\.\w+\('sign'/);

    // Aggregate states merge; no row count; simple aggregates use their own function.
    const rollup = section('daily_rollup');
    expect(rollup).not.toContain('rowResolution');
    expect(rollup).not.toContain('measure.count(');
    expect(rollup).toContain("totalOrders: measure.merge('count', 'orders', { label: 'Total Orders' }),");
    expect(rollup).toContain("totalRevenueCents: measure.merge('sum', 'revenue_cents', { label: 'Total Revenue Cents' }),");
    expect(rollup).toContain("uniqueBuyers: measure.merge('uniq', 'buyers', { label: 'Unique Buyers' }),");
    expect(rollup).toContain(
      '// p90_latency (AggregateFunction(quantile(0.9), Float64)) is not included: no merge measure reads quantile(0.9) states.',
    );
    expect(rollup).toContain("maxPeakAmount: measure.max('peakAmount', { label: 'Max Peak Amount' }),");
    expect(rollup).toContain("maxLatitude: measure.max('latitude', { label: 'Max Latitude' }),");
    expect(rollup).toContain("maxLatestAt: measure.max('latestAt', { label: 'Max Latest At' }),");
    expect(rollup).not.toContain('no dimension type describes');
    expect(rollup).not.toMatch(/measure\.(?:sum|avg)\(/);

    // SummingMergeTree sums only its summing columns, and never averages or counts rows.
    const totals = section('daily_totals');
    expect(totals).toContain("totalAmount: measure.sum('amount', { label: 'Total Amount' }),");
    expect(totals).not.toMatch(/measure\.\w+\('tax'/);
    expect(totals).not.toMatch(/measure\.(?:count|avg)\(/);

    // Without a column list it sums numeric columns outside the sorting key only.
    const priorityTotals = section('priority_totals');
    expect(priorityTotals).toContain("totalAmount: measure.sum('amount', { label: 'Total Amount' }),");
    expect(priorityTotals).not.toMatch(/measure\.\w+\('priority'/);

    // A plain MergeTree is unchanged.
    const events = section('events');
    expect(events).not.toContain('rowResolution');
    expect(events).toContain("totalCount: measure.count('id'");
    expect(events).toContain("avgValue: measure.avg('value'");

    await writeFile(
      tsconfigPath,
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          skipLibCheck: true,
          noEmit: true,
          paths: {
            '@hypequery/datasets': [path.join(repoRoot, 'packages/datasets/src/index.ts')],
          },
        },
        include: [outputPath],
      }, null, 2),
    );
    await execFileAsync(
      path.join(repoRoot, 'packages/cli/node_modules/.bin/tsc'),
      ['--project', tsconfigPath],
      { cwd: repoRoot },
    );
  }, TSC_TIMEOUT_MS);

  it('scaffolds plain MergeTree datasets when table engines cannot be read', async () => {
    const injectedQuery = vi.fn(async ({ query }: { query: string }) => {
      if (query === 'SHOW TABLES') return { json: async () => [{ name: 'events' }] };
      if (query === 'DESCRIBE TABLE events') {
        return { json: async () => [{ name: 'id', type: 'UInt64', default_type: '', default_expression: '' }] };
      }
      throw new Error('Not enough privileges');
    });

    const { contents } = await generateDatasets({
      outputPath: 'unused.ts',
      client: { query: injectedQuery },
      writeOutput: false,
    });

    expect(contents).toContain("totalCount: measure.count('id'");
    expect(contents).not.toContain('rowResolution');
  });
});
