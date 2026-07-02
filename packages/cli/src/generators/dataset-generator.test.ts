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
          ],
        };
      }

      throw new Error(`Unexpected query: ${query}`);
    });

    const workdir = await mkdtemp(path.join(tmpdir(), 'hq-dataset-generator-'));
    const outputPath = path.join(workdir, 'generated.ts');
    const tsconfigPath = path.join(workdir, 'tsconfig.json');
    const repoRoot = path.resolve(__dirname, '../../../..');

    await generateDatasets({ outputPath });

    const generated = await readFile(outputPath, 'utf8');
    expect(generated).toContain("totalCount: measure.count('id'");
    expect(generated).toContain("totalAmount: measure.sum('amount'");
    expect(generated).toContain("avgAmount: measure.avg('amount'");
    expect(generated).toContain("totalDurationSeconds: measure.sum('durationSeconds'");
    expect(generated).toContain("avgDurationSeconds: measure.avg('durationSeconds'");
    expect(generated).toContain("paymentType: dimension.string({ column: 'payment_type'");
    expect(generated).toContain("status: dimension.string({ label: 'Status' })");
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
          baseUrl: repoRoot,
          paths: {
            '@hypequery/datasets': ['packages/datasets/src/index.ts'],
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
  });
});
