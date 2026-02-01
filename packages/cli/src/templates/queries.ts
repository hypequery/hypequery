/**
 * Generate queries.ts file
 */
export function generateQueriesTemplate(options: {
  hasExample: boolean;
  tableName?: string;
  exampleMode?: boolean;
}): string {
  const { hasExample, tableName, exampleMode } = options;

  if (exampleMode) {
    return generateExampleQueriesTemplate();
  }

  const metricKey = hasExample && tableName ? `${camelCase(tableName)}Query` : 'exampleMetric';
  const typeAlias = `${pascalCase(metricKey)}Result`;

  let template = `import { initServe } from '@hypequery/serve';
import type { InferApiType } from '@hypequery/serve';
import { z } from 'zod';
import { db } from './client';

const serve = initServe({
  context: () => ({ db }),
});
const { query } = serve;

export const api = serve.define({
  queries: serve.queries({`;

  if (hasExample && tableName) {
    template += `
    ${camelCase(tableName)}Query: query
      .describe('Example query using the ${tableName} table')
      .query(async ({ ctx }) =>
        ctx.db
          .table('${tableName}')
          .select('*')
          .limit(10)
          .execute()
      ),`;
  } else {
    template += `
    exampleMetric: query
      .describe('Example metric that returns a simple value')
      .output(z.object({ ok: z.boolean() }))
      .query(async () => ({ ok: true })),`;
  }

  template += `
  }),
});

export type ApiDefinition = InferApiType<typeof api>;

/**
 * Inline usage example:
 *
 * const result = await api.execute('${metricKey}');
 * console.log(result);
 *
 * // import type { InferQueryResult } from '@hypequery/serve';
 * type ${typeAlias} = InferQueryResult<typeof api, '${metricKey}'>;
 *
 * // Register HTTP route:
 * api.route('/metrics/${metricKey}', api.queries.${metricKey});
 *
 * Dev server:
 * npx hypequery dev
 */
`;

  return template;
}

/**
 * Generate rich example queries that showcase hypequery's API
 * without requiring a real ClickHouse connection.
 */
function generateExampleQueriesTemplate(): string {
  return `import { initServe } from '@hypequery/serve';
import type { InferApiType } from '@hypequery/serve';
import { db } from './client';

const serve = initServe({
  context: () => ({ db }),
});
const { query } = serve;

export const api = serve.define({
  queries: serve.queries({
    // Fetch the 10 most recent users
    recentUsers: query
      .describe('Fetch the 10 most recent users')
      .query(async ({ ctx }) =>
        ctx.db
          .table('users')
          .select('id', 'name', 'email', 'plan', 'created_at')
          .orderBy('created_at', 'DESC')
          .limit(10)
          .execute()
      ),

    // Summarise orders by status
    ordersByStatus: query
      .describe('Count orders grouped by status')
      .query(async ({ ctx }) =>
        ctx.db
          .table('orders')
          .select('status')
          .count('id', 'total')
          .sum('amount', 'revenue')
          .groupBy('status')
          .execute()
      ),

    // Top pages by event count
    topPages: query
      .describe('Top 10 pages by number of events')
      .query(async ({ ctx }) =>
        ctx.db
          .table('page_events')
          .select('page')
          .count('event_id', 'views')
          .groupBy('page')
          .orderBy('views', 'DESC')
          .limit(10)
          .execute()
      ),
  }),
});

export type ApiDefinition = InferApiType<typeof api>;

/**
 * Try it out:
 *
 *   const users  = await api.execute('recentUsers');
 *   const orders = await api.execute('ordersByStatus');
 *   const pages  = await api.execute('topPages');
 *
 * Start the dev server:
 *   npx hypequery dev
 */
`;
}

/**
 * Convert table name to camelCase
 */
function camelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function pascalCase(str: string): string {
  const camel = camelCase(str);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}
