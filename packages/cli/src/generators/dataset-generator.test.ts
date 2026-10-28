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
    expect(generated).toContain('// geo.country is geoCountry2: geoCountry is taken.');
    expect(generated).toContain(
      `geoCountry2: dimension.string({ sql: "tupleElement(geo, 'country')", dependencies: ['geo'], label: 'Geo Country' })`,
    );
    expect(generated).toContain("fareTotal: dimension.number({ column: 'fare_total', label: 'Fare Total' })");
    expect(generated).toContain('// fareTotal is fareTotal2: fareTotal is taken.');
    expect(generated).toContain("fareTotal2: dimension.number({ column: 'fareTotal', label: 'FareTotal' })");
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
});
