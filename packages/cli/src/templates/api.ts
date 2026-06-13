/**
 * Generate api.ts file for the semantic datasets API.
 */
export function generateApiTemplate(): string {
  return `import { createAPI, fromContext } from '@hypequery/serve';
import type { InferApiType } from '@hypequery/serve';
import { db } from './client.js';
import { datasets } from './datasets.js';

type HostUser = {
  id: string;
  orgId: string;
  roles?: string[];
};

const getUserFromRequest = (raw: unknown): HostUser | null => {
  const request = raw as { user?: HostUser };
  return request.user ?? null;
};

export const api = createAPI({
  queryBuilder: db,
  datasets,
  auth: fromContext(({ request }) => {
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
});

export type ApiDefinition = InferApiType<typeof api>;
`;
}
