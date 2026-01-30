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
 * Convert table name to camelCase
 */
function camelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function pascalCase(str: string): string {
  const camel = camelCase(str);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}
