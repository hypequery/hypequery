/**
 * Generate api.ts file for the semantic datasets API.
 */
export type AuthTemplateMode = 'none' | 'context';

export function generateApiTemplate(options: { auth?: AuthTemplateMode } = {}): string {
  const authMode = options.auth ?? 'none';
  const serveImports = authMode === 'context' ? 'createAPI, fromContext' : 'createAPI';
const authHelpers = authMode === 'context'
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
  const authConfig = authMode === 'context'
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

  return `import { ${serveImports} } from '@hypequery/serve';
import type { InferApiType } from '@hypequery/serve';
import { db } from './client.js';
import { datasets } from './datasets.js';
${authHelpers}

export const api = createAPI({
  queryBuilder: db,
  datasets,
${authConfig}
});

export type ApiDefinition = InferApiType<typeof api>;
`;
}
