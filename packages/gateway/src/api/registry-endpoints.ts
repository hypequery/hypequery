import type { EndpointContext, RegistryEntry } from './types.js';
import { sendJSON, sendError } from './helpers.js';

/**
 * GET /__dev/registry
 * List all serve endpoints (queries + semantic dataset/metric routes) mapped
 * from serve's `describe()` (ToolkitDescription). Written fresh against the
 * DevIntegrationApi — the donor's registry endpoint was deleted upstream.
 */
export async function getRegistry(ctx: EndpointContext): Promise<void> {
  try {
    if (!ctx.api) {
      return sendJSON(ctx.res, { endpoints: [], total: 0 });
    }

    const description = ctx.api.describe();
    const endpoints: RegistryEntry[] = description.queries.map((q) => ({
      key: q.key,
      name: q.name,
      path: q.path,
      method: q.method,
      description: q.description ?? q.summary,
      tags: q.tags ?? [],
      hasInput: q.inputSchema != null,
      hasTenant: q.requiresTenant ?? false,
      requiresAuth: q.requiresAuth ?? false,
      requiredRoles: q.requiredRoles,
      requiredScopes: q.requiredScopes,
      visibility: q.visibility,
      inputSchema: q.inputSchema ?? null,
      outputSchema: q.outputSchema ?? null,
      custom: q.custom
    }));

    sendJSON(ctx.res, {
      basePath: description.basePath,
      endpoints,
      total: endpoints.length
    });
  } catch (error) {
    console.error('[gateway] getRegistry error:', error);
    sendError(ctx.res, (error as Error).message);
  }
}
