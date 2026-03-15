import type { EndpointContext, RegistryEntry } from './types.js';
import { sendJSON, sendError } from './helpers.js';

/**
 * Extract field names from a Zod schema (basic extraction).
 */
function extractSchemaFields(schema: unknown): string[] | undefined {
  if (!schema) return undefined;

  const schemaAny = schema as {
    shape?: Record<string, unknown>;
    _def?: { shape?: () => Record<string, unknown> };
  };

  if (schemaAny.shape && typeof schemaAny.shape === 'object') {
    return Object.keys(schemaAny.shape);
  }

  if (schemaAny._def?.shape && typeof schemaAny._def.shape === 'function') {
    try {
      return Object.keys(schemaAny._def.shape());
    } catch {
      return undefined;
    }
  }

  return undefined;
}

/**
 * GET /__dev/registry
 * List all registered endpoints with full metadata for the registry screen.
 */
export async function getRegistry(ctx: EndpointContext): Promise<void> {
  try {
    if (!ctx.api?.endpoints) {
      return sendJSON(ctx.res, { entries: [], total: 0 });
    }

    const entries: RegistryEntry[] = Object.entries(ctx.api.endpoints).map(([key, endpoint]) => {
      const metadata = endpoint.metadata;
      const cacheTtl = endpoint.cacheTtlMs ?? metadata?.cacheTtlMs;

      return {
        key,
        name: metadata?.name || key,
        path: endpoint.path || metadata?.path || `/${key}`,
        method: endpoint.method || metadata?.method || 'GET',
        description: metadata?.description || endpoint.description,
        tags: metadata?.tags || endpoint.tags || [],
        hasInput: endpoint.inputSchema !== undefined,
        inputFields: extractSchemaFields(endpoint.inputSchema),
        hasTenant: endpoint.tenant !== undefined,
        isCached: cacheTtl !== undefined && cacheTtl !== null && cacheTtl > 0,
        cacheTtlMs: typeof cacheTtl === 'number' ? cacheTtl : undefined,
        requiresAuth: metadata?.requiresAuth || false,
        requiredRoles: metadata?.requiredRoles,
        requiredScopes: metadata?.requiredScopes,
        visibility: metadata?.visibility,
        custom: metadata?.custom,
      };
    });

    sendJSON(ctx.res, { entries, total: entries.length });
  } catch (error) {
    console.error('[API] getRegistry error:', error);
    sendError(ctx.res, (error as Error).message);
  }
}

/**
 * GET /__dev/queries/available
 * List all available query endpoints (legacy, use getRegistry for full info).
 */
export async function getAvailableQueries(ctx: EndpointContext): Promise<void> {
  try {
    if (!ctx.api?.endpoints) {
      return sendJSON(ctx.res, { queries: [], total: 0 });
    }

    const queries = Object.entries(ctx.api.endpoints).map(([key, endpoint]) => ({
      key,
      path: endpoint.path || `/${key}`,
      method: endpoint.method || 'GET',
      description: endpoint.description,
      tags: endpoint.tags || [],
      hasInput: endpoint.inputSchema !== undefined
    }));

    sendJSON(ctx.res, { queries, total: queries.length });
  } catch (error) {
    console.error('[API] getAvailableQueries error:', error);
    sendError(ctx.res, (error as Error).message);
  }
}
