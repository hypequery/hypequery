import { projectAgentSafeCatalog, type AgentCatalogSource } from '@hypequery/datasets';
import type { AuthContext, ServeEndpoint } from '../../types.js';

/** Logical discovery uses a closed projection, never the execution contract. */
export function createDiscoveryEndpoint(
  path: string,
  getSource: () => AgentCatalogSource,
  policy: { requiresAuth?: boolean; requiredRoles?: string[]; requiredScopes?: string[] } = {},
): ServeEndpoint<any, any, Record<string, unknown>, AuthContext> {
  // Fail at startup if the discovery budget is exceeded, then freeze the snapshot.
  const catalog = projectAgentSafeCatalog(getSource());
  return {
    key: '__hypequery_discovery__',
    method: 'GET',
    inputSchema: undefined,
    outputSchema: undefined,
    handler: async () => catalog,
    query: undefined,
    middlewares: [],
    auth: null,
    cacheTtlMs: null,
    requiredRoles: policy.requiredRoles,
    requiredScopes: policy.requiredScopes,
    metadata: {
      path,
      method: 'GET',
      name: 'Discovery',
      tags: ['datasets'],
      requiresAuth: policy.requiresAuth ?? true,
      requiredRoles: policy.requiredRoles,
      requiredScopes: policy.requiredScopes,
      visibility: 'public',
    },
  };
}
