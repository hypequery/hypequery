/**
 * Converts a DatasetInstance into a standard ServeEndpoint for semantic queries.
 *
 * The generated endpoint is a POST handler that:
 * - Accepts dimensions, measures, filters, orderBy, limit, offset, by
 * - Validates requested dimensions/measures/filters against the dataset contract
 * - Executes via QueryBuilderFactoryLike
 * - Applies Serve-managed tenant filtering when configured
 * - Returns { data } or { data, meta } based on headers
 */

import { z } from 'zod';
import type {
  AuthContext,
  EndpointHandler,
  EndpointMetadata,
  ServeEndpoint,
  ServeMiddleware,
} from '../../types.js';
import type {
  QueryBuilderFactoryLike,
} from '@hypequery/datasets';
import type { DatasetQuery } from '@hypequery/datasets/internal';
import {
  runDatasetQuery,
  validateDatasetQuery,
} from '@hypequery/datasets/internal';
import { ServeHttpError } from '../../errors.js';
import {
  resolveSemanticExecutionRuntime,
  resolveSemanticQueryBuilder,
  resolveSemanticTenantHandledByBuilder,
} from '../query-builder-context.js';
import { buildDatasetQueryDescription } from './utils/dataset-query-metadata.js';
import { resolveDatasetEntry, type DatasetEntry } from './utils/dataset-entry.js';

export type { DatasetEntry } from './utils/dataset-entry.js';

// ---------------------------------------------------------------------------
// Zod schemas for dataset query input / output
// ---------------------------------------------------------------------------

const datasetFilterSchema = z.object({
  field: z.string(),
  operator: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn', 'between', 'like']),
  value: z.unknown(),
});

const datasetOrderBySchema = z.object({
  field: z.string(),
  direction: z.enum(['asc', 'desc']),
});

const datasetQueryInputSchema = z.object({
  dimensions: z.array(z.string()).optional(),
  measures: z.array(z.string()).optional(),
  filters: z.array(datasetFilterSchema).optional(),
  orderBy: z.array(datasetOrderBySchema).optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
  by: z.enum(['day', 'week', 'month', 'quarter', 'year']).optional(),
}).strict();

const datasetResultMetaSchema = z.object({
  timingMs: z.number().optional(),
  sql: z.string().optional(),
  tenant: z.string().optional(),
}).optional();

const datasetResultSchema = z.object({
  data: z.array(z.record(z.unknown())),
  meta: datasetResultMetaSchema,
});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createDatasetEndpoint<TAuth extends AuthContext>(
  name: string,
  entry: DatasetEntry<TAuth>,
  builderFactory: QueryBuilderFactoryLike,
): ServeEndpoint<typeof datasetQueryInputSchema, typeof datasetResultSchema, any, TAuth, any> {
  const resolved = resolveDatasetEntry(entry);
  const ds = resolved.dataset;
  const effectiveMaxLimit = resolved.maxLimit ?? ds.limits?.maxResultSize ?? 1000;

  const metadata: EndpointMetadata = {
    path: '', // filled by router.register
    method: 'POST',
    name: name,
    summary: `Query the "${name}" semantic dataset`,
    description: buildDatasetQueryDescription(ds, effectiveMaxLimit),
    tags: ['datasets'],
    requiresAuth: resolved.auth !== null ? undefined : false,
    requiredRoles: resolved.requiredRoles,
    requiredScopes: resolved.requiredScopes,
    cacheTtlMs: resolved.cache,
    visibility: 'public',
    custom: {
      usesServeTenantRuntime: true,
    },
  };

  const handler: EndpointHandler<any, any, any, TAuth> = async (ctx) => {
    const semanticContext: Record<string, unknown> = ctx;
    const input = ctx.input ?? {};
    const start = Date.now();
    const runtime = resolveSemanticExecutionRuntime(semanticContext);

    // Validate
    const query: DatasetQuery = {
      dimensions: input.dimensions,
      measures: input.measures,
      filters: input.filters,
      orderBy: input.orderBy,
      limit: Math.min(input.limit ?? effectiveMaxLimit, effectiveMaxLimit),
      offset: input.offset,
      by: input.by,
    };
    const executionContext = runtime ? { runtime } : undefined;
    const validation = validateDatasetQuery(ds, query, executionContext);
    if (!validation.valid) {
      throw new ServeHttpError(
        400,
        'VALIDATION_ERROR',
        validation.errors.join('; ')
      );
    }

    // Build query
    const runtimeBuilderFactory = resolveSemanticQueryBuilder(
      semanticContext,
      builderFactory,
    );
    if (ctx.tenantId) {
      if (!runtime?.tenant || !ds.tenantKey) {
        throw new ServeHttpError(
          500,
          'INTERNAL_SERVER_ERROR',
          `Dataset endpoint "${name}" requires dataset tenantKey and serve tenant runtime when tenant isolation is enabled.`,
        );
      }
    }
    const result = await runDatasetQuery(ds, query, {
      builderFactory: runtimeBuilderFactory,
      context: executionContext,
      tenantHandledByBuilder: resolveSemanticTenantHandledByBuilder(semanticContext),
    });
    const timingMs = Date.now() - start;

    // Meta
    const includeMeta = ctx.request?.headers?.['x-include-meta'] === 'true';

    return {
      data: result.data,
      meta: includeMeta ? {
        ...(result.meta ?? {}),
        timingMs,
      } : undefined,
    };
  };

  return {
    key: name,
    method: 'POST',
    inputSchema: datasetQueryInputSchema,
    outputSchema: datasetResultSchema,
    handler,
    query: undefined,
    middlewares: [] as ServeMiddleware<any, any, any, TAuth>[],
    auth: resolved.auth ?? null,
    tenant: resolved.tenant,
    metadata,
    cacheTtlMs: resolved.cache ?? null,
    defaultHeaders: undefined,
    requiredRoles: resolved.requiredRoles,
    requiredScopes: resolved.requiredScopes,
  };
}
