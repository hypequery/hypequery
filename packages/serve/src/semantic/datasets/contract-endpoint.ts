/**
 * Exposes the semantic contract for registered datasets/metrics as a GET endpoint.
 *
 * The contract is a stable, hashed JSON projection of the semantic layer
 * (dimensions, measures, metrics, filters, relationships, tenant/time policy).
 * It is the shared source consumed by snapshots, CI validation, docs, and
 * codegen. The serialized document is cached after the first request since the
 * registered datasets do not change at runtime.
 */

import { z } from 'zod';
import { serializeSemanticContract, type SemanticContract } from '@hypequery/datasets';
import type { AuthContext, ServeEndpoint } from '../../types.js';

export function createSemanticContractEndpoint(
  path: string,
  getContract: () => SemanticContract,
): ServeEndpoint<any, any, Record<string, unknown>, AuthContext> {
  let cached: SemanticContract | null = null;
  return {
    key: '__hypequery_semantic_contract__',
    method: 'GET',
    inputSchema: undefined,
    outputSchema: z.any(),
    handler: async () => {
      if (!cached) {
        cached = getContract();
      }
      return cached;
    },
    query: undefined,
    middlewares: [],
    auth: null,
    metadata: {
      path,
      method: 'GET',
      name: 'Semantic contract',
      summary: 'Semantic contract',
      description:
        'Stable, hashed JSON contract for the registered semantic datasets and metrics. ' +
        'Use it for snapshots, CI validation, docs, and codegen.',
      tags: ['datasets'],
      requiresAuth: false,
      deprecated: false,
      visibility: 'public',
    },
    cacheTtlMs: null,
  } satisfies ServeEndpoint<any, any, Record<string, unknown>, AuthContext>;
}

export { serializeSemanticContract };
