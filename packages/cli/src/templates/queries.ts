/**
 * Generate queries.ts file
 */
export function generateQueriesTemplate(options: {
  hasExample: boolean;
  tableName?: string;
}): string {
  const { hasExample, tableName } = options;

  let template = `import { defineServe } from '@hypequery/serve';
import { z } from 'zod';
import { db } from './client';

export const api = defineServe({
  context: () => ({ db }),
  queries: {`;

  if (hasExample && tableName) {
    template += `
    ${camelCase(tableName)}Query: {
      description: 'Example query using the ${tableName} table',
      query: async ({ ctx }) =>
        ctx.db
          .from('${tableName}')
          .select('*')
          .limit(10),
      outputSchema: z.array(z.any()),
    },`;
  } else {
    template += `
    exampleMetric: {
      description: 'Example metric that returns a simple value',
      query: async () => ({ ok: true }),
      outputSchema: z.object({ ok: z.boolean() }),
    },`;
  }

  template += `
  },
});

/**
 * Inline usage example:
 *
 * const result = await api.execute('${hasExample && tableName ? camelCase(tableName) + 'Query' : 'exampleMetric'}');
 * console.log(result);
 *
 * Dev server:
 *
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
