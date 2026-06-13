/**
 * Generate queries.ts file
 */
export type AuthTemplateMode = 'none' | 'context';

export function generateQueriesTemplate(options: {
  hasExample: boolean;
  tableName?: string;
  auth?: AuthTemplateMode;
}): string {
  const { hasExample, tableName, auth = 'none' } = options;
  const metricKey = hasExample && tableName ? `${camelCase(tableName)}Query` : 'exampleMetric';
  const typeAlias = `${pascalCase(metricKey)}Result`;
  const routePath = `/metrics/${metricKey}`;
  const serveImports = auth === 'context' ? 'fromContext, initServe' : 'initServe';
const authHelpers = auth === 'context'
    ? `
type HostUser = {
  id: string;
  orgId: string;
  roles?: string[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isHostUser = (value: unknown): value is HostUser => {
  if (!isRecord(value)) return false;
  const roles = value.roles;
  return typeof value.id === 'string' &&
    typeof value.orgId === 'string' &&
    (roles === undefined || (Array.isArray(roles) && roles.every((role) => typeof role === 'string')));
};

const getUserFromRequest = (raw: unknown): HostUser | null => {
  const user = isRecord(raw) ? raw.user : null;
  return isHostUser(user) ? user : null;
};
`
    : '';
  const authConfig = auth === 'context'
    ? `  auth: fromContext(({ request }) => {
    const user = getUserFromRequest(request.raw);
    return user
      ? { userId: user.id, tenantId: user.orgId, roles: user.roles }
      : null;
  }),
  tenant: {
    extract: (auth: { tenantId?: string }) => auth.tenantId,
    column: 'tenant_id',
    mode: 'auto-inject',
  },
`
    : '';

  let template = `import { ${serveImports} } from '@hypequery/serve';
import type { InferApiType } from '@hypequery/serve';
import { z } from 'zod';
import { db } from './client.js';
${authHelpers}

const { query, serve } = initServe({
  context: () => ({ db }),
${authConfig}
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
api.route('${routePath}', api.queries.${metricKey});

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
 * HTTP route:
 * ${routePath}
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
