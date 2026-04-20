/**
 * Generate queries.ts file
 */
export function generateQueriesTemplate(options: {
  hasExample: boolean;
  tableName?: string;
}): string {
  const { hasExample, tableName } = options;
  const metricKey = hasExample && tableName ? `${camelCase(tableName)}Query` : 'exampleMetric';
  const typeAlias = `${pascalCase(metricKey)}Result`;

  let template = `import { initServe } from '@hypequery/serve';
import type { InferApiType } from '@hypequery/serve';
import { z } from 'zod';
import { db } from './client';

const { query, serve } = initServe({
  context: () => ({ db }),
});

`;

  if (hasExample && tableName) {
    template += `
const ${camelCase(tableName)}Query = query({
  description: 'Example query using the ${tableName} table',
  query: async ({ ctx }) =>
    ctx.db
      .table('${tableName}')
      .select('*')
      .limit(10)
      .execute(),
});`;
  } else {
    template += `
const exampleMetric = query({
  description: 'Example metric that returns a simple value',
  output: z.object({ ok: z.boolean() }),
  query: async () => ({ ok: true }),
});`;
  }

  template += `
export const api = serve({
  queries: {
    ${metricKey},
  },
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
 * npx hypequery dev analytics/queries.ts
 */
`;

  return template;
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
