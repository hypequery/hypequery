import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const files = {
  'package.json': `{
  "name": "hypequery-semantic-consumer-smoke",
  "private": true,
  "type": "module"
}
`,
  'tsconfig.json': `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["valid-*.ts"]
}
`,
  'valid-root-imports.ts': `import { createDatasetClient, dataset, dimension, measure } from '@hypequery/datasets';
import type { DatasetClient, MetricQuery } from '@hypequery/datasets';
import { createAPI } from '@hypequery/serve';

const Orders = dataset('orders', {
  source: 'orders',
  timeKey: 'created_at',
  dimensions: {
    id: dimension.number(),
    status: dimension.string(),
    amount: dimension.number(),
    createdAt: dimension.timestamp({ column: 'created_at' }),
  },
  measures: {
    revenue: measure.sum('amount'),
    medianAmount: measure.median('amount'),
    p95Amount: measure.percentile('amount', 0.95),
    amountStddev: measure.stddev('amount'),
    amountVariance: measure.variance('amount'),
    latestAmount: measure.argMax('amount', 'createdAt'),
    earliestAmount: measure.argMin('amount', 'createdAt'),
  },
});

const revenue = Orders.metric('revenue', { measure: 'revenue' });
const latestAmount = Orders.metric('latestAmount', { measure: 'latestAmount' });
const query: MetricQuery = { dimensions: ['status'] };

const api = createAPI({});
const analytics = createDatasetClient({
  queryBuilder: {
    table() {
      throw new Error('not executed');
    },
    async rawQuery() {
      return [];
    },
  },
});
const explicitAnalytics: DatasetClient = analytics;

void revenue;
void latestAmount;
void query;
void explicitAnalytics;
void api;
`,
  'valid-internal-import.ts': `import { runDatasetQuery } from '@hypequery/datasets/internal';
import type { DatasetQuery } from '@hypequery/datasets/internal';

const query: DatasetQuery = { measures: ['revenue'] };

void runDatasetQuery;
void query;
`,
  'invalid-root-dataset-query.ts': `import { runDatasetQuery } from '@hypequery/datasets';

void runDatasetQuery;
`,
  'invalid-root-executor.ts': `import { createExecutor, MetricExecutor, SemanticExecutor } from '@hypequery/datasets';

void createExecutor;
void MetricExecutor;
void SemanticExecutor;
`,
  'invalid-deep-import.ts': `import { createAPI } from '@hypequery/serve/dist/server/create-api.js';

void createAPI;
`,
  'runtime.mjs': `import { dataset, dimension, measure } from '@hypequery/datasets';
import { createAPI } from '@hypequery/serve';

const Orders = dataset('orders', {
  source: 'orders',
  dimensions: {
    id: dimension.number(),
    amount: dimension.number(),
    createdAt: dimension.timestamp({ column: 'created_at' }),
  },
  measures: {
    revenue: measure.sum('amount'),
    p95Amount: measure.percentile('amount', 0.95),
    amountStddev: measure.stddev('amount'),
    latestAmount: measure.argMax('amount', 'createdAt'),
  },
});

const api = createAPI({});

if (Orders.name !== 'orders' || typeof api.describe !== 'function') {
  throw new Error('semantic consumer runtime import smoke failed');
}
`,
};

const targetDirectory = process.argv[2];
if (!targetDirectory) {
  throw new Error('Usage: node scripts/utils/write-semantic-consumer-fixtures.mjs <target-directory>');
}

await mkdir(targetDirectory, { recursive: true });

await Promise.all(
  Object.entries(files).map(([fileName, contents]) =>
    writeFile(path.join(targetDirectory, fileName), contents),
  ),
);
