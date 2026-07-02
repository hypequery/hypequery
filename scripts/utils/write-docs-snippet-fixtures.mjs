/**
 * Extracts TypeScript code blocks from the datasets guide pages
 * (website-next/docs/datasets/*.mdx) into standalone modules that
 * `smoke-docs-snippets.sh` type-checks against the built packages.
 *
 * Guide snippets often reference identifiers introduced by earlier snippets
 * on the same page (Orders, analytics, revenue, ...). Shared fixtures in
 * global-fixtures.ts mirror those as ambient globals so each snippet
 * compiles in isolation; a snippet that declares or imports the same name
 * simply shadows the global.
 *
 * Block handling:
 * - blocks whose first code line starts with `{` are skipped (illustrative
 *   object shapes, not statements)
 * - blocks starting with a bare `name:` property are object fragments and get
 *   wrapped in `const __snippet = { ... };`
 * - everything else compiles as-is; `export {}` is appended so every snippet
 *   is module-scoped (enables top-level await and global shadowing)
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, '..', '..');
const docsDirectory = path.join(repoRoot, 'website-next', 'docs', 'datasets');

const staticFiles = {
  'package.json': `{
  "name": "hypequery-docs-snippet-smoke",
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
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["global-fixtures.ts", "snippets/**/*.ts"]
}
`,
  'global-fixtures.ts': `import * as hq from '@hypequery/datasets';
import { createQueryBuilder } from '@hypequery/clickhouse';
import { initServe } from '@hypequery/serve';

const {
  createDatasetClient,
  dataset: datasetHelper,
  dimension: dimensionHelper,
  measure: measureHelper,
  generateDatasetTools,
} = hq;

interface DocsSchema {
  orders: {
    id: 'UInt64';
    tenant_id: 'String';
    status: 'String';
    country: 'String';
    email: 'String';
    amount: 'Float64';
    created_at: 'DateTime';
  };
  customers: {
    id: 'String';
    country: 'String';
  };
  users: {
    user_id: 'String';
    is_active: 'UInt8';
    created_at: 'DateTime';
  };
}

// createQueryBuilder<Schema> does not yet structurally satisfy
// QueryBuilderFactoryLike (typed select/sum/where overloads fail
// assignability), so cast through the protocol type the docs rely on.
const dbFixture = createQueryBuilder<DocsSchema>({
  url: 'http://localhost:8123',
  username: 'default',
  password: '',
  database: 'docs',
}) as unknown as hq.QueryBuilderFactoryLike;

const analyticsFixture = createDatasetClient({ queryBuilder: dbFixture });

const OrdersFixture = datasetHelper('orders', {
  source: 'orders',
  tenantKey: 'tenant_id',
  timeKey: 'created_at',
  dimensions: {
    id: dimensionHelper.number(),
    tenantId: dimensionHelper.string({ column: 'tenant_id' }),
    status: dimensionHelper.string(),
    country: dimensionHelper.string(),
    email: dimensionHelper.string(),
    createdAt: dimensionHelper.timestamp({ column: 'created_at' }),
  },
  measures: {
    revenue: measureHelper.sum('amount'),
    orderCount: measureHelper.count('id'),
  },
});

const CustomersFixture = datasetHelper('customers', {
  source: 'customers',
  dimensions: {
    id: dimensionHelper.string(),
    country: dimensionHelper.string(),
  },
  measures: {
    customerCount: measureHelper.count('id'),
  },
});

const UsersFixture = datasetHelper('users', {
  source: 'users',
  dimensions: {
    userId: dimensionHelper.string({ column: 'user_id' }),
    isActive: dimensionHelper.boolean({ column: 'is_active' }),
    createdAt: dimensionHelper.timestamp({ column: 'created_at' }),
  },
  measures: {
    userCount: measureHelper.count('user_id'),
  },
});

const revenueFixture = OrdersFixture.metric('revenue', { measure: 'revenue' });
const orderCountFixture = OrdersFixture.metric('orderCount', { measure: 'orderCount' });

const toolsFixture = generateDatasetTools({
  datasets: { orders: OrdersFixture },
  analytics: analyticsFixture,
  mode: 'catalog',
});

const initServeFixture = initServe({
  context: () => ({ db: dbFixture }),
});

declare global {
  const db: typeof dbFixture;
  const analytics: typeof analyticsFixture;
  const Orders: typeof OrdersFixture;
  const Customers: typeof CustomersFixture;
  const Users: typeof UsersFixture;
  const revenue: typeof revenueFixture;
  const orderCount: typeof orderCountFixture;
  const tools: typeof toolsFixture;
  const serve: typeof initServeFixture.serve;
  const query: typeof initServeFixture.query;
  const dataset: typeof datasetHelper;
  const dimension: typeof dimensionHelper;
  const measure: typeof measureHelper;
  const getDatasetCatalog: typeof hq.getDatasetCatalog;
  const generateDatasetTools: typeof hq.generateDatasetTools;
  const eq: typeof hq.eq;
  const neq: typeof hq.neq;
  const gt: typeof hq.gt;
  const gte: typeof hq.gte;
  const lt: typeof hq.lt;
  const lte: typeof hq.lte;
  const inList: typeof hq.inList;
  const notInList: typeof hq.notInList;
  const between: typeof hq.between;
  const like: typeof hq.like;
  const asc: typeof hq.asc;
  const desc: typeof hq.desc;
  const divide: typeof hq.divide;
  const multiply: typeof hq.multiply;
  const add: typeof hq.add;
  const subtract: typeof hq.subtract;
  const nullIfZero: typeof hq.nullIfZero;
  const coalesce: typeof hq.coalesce;
  const round: typeof hq.round;
  type BaseMetricRef = hq.BaseMetricRef;
  type FormulaExpr = hq.FormulaExpr;
  type MetricFilter = hq.MetricFilter;
}

export {};
`,
  'snippets/db.ts': `import { createQueryBuilder } from '@hypequery/clickhouse';
import type { QueryBuilderFactoryLike } from '@hypequery/datasets';

interface DocsSchema {
  orders: {
    id: 'UInt64';
    status: 'String';
    country: 'String';
    amount: 'Float64';
    created_at: 'DateTime';
  };
}

// createQueryBuilder<Schema> does not yet structurally satisfy
// QueryBuilderFactoryLike (typed select/sum/where overloads fail
// assignability), so cast through the protocol type the docs rely on.
export const db = createQueryBuilder<DocsSchema>({
  url: 'http://localhost:8123',
  username: 'default',
  password: '',
  database: 'docs',
}) as unknown as QueryBuilderFactoryLike;
`,
  'snippets/client.ts': `export { db } from './db.js';
`,
  'snippets/datasets/orders.ts': `import { dataset, dimension, measure } from '@hypequery/datasets';

export const Orders = dataset('orders', {
  source: 'orders',
  timeKey: 'created_at',
  dimensions: {
    id: dimension.number(),
    status: dimension.string(),
    country: dimension.string(),
    createdAt: dimension.timestamp({ column: 'created_at' }),
  },
  measures: {
    revenue: measure.sum('amount'),
    orderCount: measure.count('id'),
  },
});

export const revenue = Orders.metric('revenue', { measure: 'revenue' });
`,
  'snippets/datasets/index.ts': `import { dataset, dimension, measure } from '@hypequery/datasets';

export { Orders, revenue } from './orders.js';

export const Customers = dataset('customers', {
  source: 'customers',
  dimensions: {
    id: dimension.string(),
    country: dimension.string(),
  },
  measures: {
    customerCount: measure.count('id'),
  },
});
`,
};

function extractCodeBlocks(markdown) {
  const lines = markdown.split('\n');
  const blocks = [];
  let current = null;

  for (let index = 0; index < lines.length; index++) {
    const trimmed = lines[index].trim();
    if (current === null) {
      if (/^```(typescript|ts)$/.test(trimmed)) {
        current = { line: index + 2, lines: [] };
      }
    } else if (trimmed === '```') {
      blocks.push(current);
      current = null;
    } else {
      current.lines.push(lines[index]);
    }
  }

  return blocks;
}

function firstCodeLine(code) {
  return code
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '' && !line.startsWith('//') && !line.startsWith('/*') && !line.startsWith('*'));
}

function classifyBlock(code) {
  const first = firstCodeLine(code);
  if (!first) {
    return 'skip';
  }
  if (first.startsWith('{')) {
    return 'skip';
  }
  if (/^[A-Za-z_$][\w$]*\s*:/.test(first)) {
    return 'fragment';
  }
  return 'module';
}

function renderSnippet(docName, block) {
  const code = block.lines.join('\n');
  const header = `// Source: website-next/docs/datasets/${docName}:${block.line}\n`;

  switch (classifyBlock(code)) {
    case 'skip':
      return null;
    case 'fragment':
      return `${header}const __snippet = {\n${code}\n};\n\nvoid __snippet;\n\nexport {};\n`;
    default:
      return `${header}${code}\n\nexport {};\n`;
  }
}

const targetDirectory = process.argv[2];
if (!targetDirectory) {
  throw new Error('Usage: node scripts/utils/write-docs-snippet-fixtures.mjs <target-directory>');
}

await mkdir(path.join(targetDirectory, 'snippets', 'datasets'), { recursive: true });

await Promise.all(
  Object.entries(staticFiles).map(([fileName, contents]) =>
    writeFile(path.join(targetDirectory, fileName), contents),
  ),
);

const docFiles = (await readdir(docsDirectory)).filter((name) => name.endsWith('.mdx')).sort();
let written = 0;
let skipped = 0;

for (const docName of docFiles) {
  const markdown = await readFile(path.join(docsDirectory, docName), 'utf8');
  const blocks = extractCodeBlocks(markdown);

  for (const [index, block] of blocks.entries()) {
    const snippet = renderSnippet(docName, block);
    if (snippet === null) {
      skipped += 1;
      continue;
    }
    const baseName = `${path.basename(docName, '.mdx')}.${String(index + 1).padStart(2, '0')}.ts`;
    await writeFile(path.join(targetDirectory, 'snippets', baseName), snippet);
    written += 1;
  }
}

console.log(`docs snippets: extracted ${written} snippet(s), skipped ${skipped} illustrative block(s)`);
