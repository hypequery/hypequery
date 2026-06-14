/**
 * Shared auth scaffolding snippets used by the `api.ts` and `queries.ts`
 * templates so the generated code stays identical across scaffold styles.
 */
export type AuthTemplateMode = 'none' | 'context';

/**
 * Type guards that pull a trusted `HostUser` off the underlying request. The
 * host framework is expected to have already authenticated the request and
 * attached the user to `request.raw.user`.
 */
export const hostUserHelpers = `type HostUser = {
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
};`;

/**
 * The `auth` + `tenant` config block wired to {@link hostUserHelpers}.
 * Indented two spaces so it drops straight into the config object literal.
 */
export const contextAuthConfig = `  auth: fromContext(({ request }) => {
    const user = getUserFromRequest(request.raw);
    return user
      ? { userId: user.id, tenantId: user.orgId, roles: user.roles }
      : null;
  }),
  tenant: {
    extract: (auth: { tenantId?: string }) => auth.tenantId,
    column: 'tenant_id',
    mode: 'auto-inject',
  },`;
