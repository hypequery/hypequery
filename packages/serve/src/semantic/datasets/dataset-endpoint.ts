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
} from '../query-builder-context.js';
import { buildDatasetQueryDescription } from './utils/dataset-query-metadata.js';
import { resolveDatasetEntry, type DatasetEntry } from './utils/dataset-entry.js';
import { buildDatasetInputSchema } from './utils/semantic-input-schema.js';

export type { DatasetEntry } from './utils/dataset-entry.js';

// ---------------------------------------------------------------------------
// Zod schemas for dataset query input / output
// ---------------------------------------------------------------------------

const datasetResultMetaSchema = z.object({
  timingMs: z.number().optional(),
  sql: z.string().optional(),
  tenant: z.string().optional(),
  rowCount: z.number().optional(),
  pagination: z.object({
    limit: z.number(),
    offset: z.number(),
    hasMore: z.boolean(),
  }).optional(),
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
): ServeEndpoint<z.ZodTypeAny, typeof datasetResultSchema, any, TAuth, any> {
  const resolved = resolveDatasetEntry(entry);
  const ds = resolved.dataset;
  const effectiveMaxLimit = resolved.maxLimit ?? ds.limits?.maxResultSize ?? 1000;
  // Build a schema whose dimension/measure/filter fields are enumerated from
  // this dataset's contract, so OpenAPI/docs and clients see the valid fields.
  const datasetQueryInputSchema = buildDatasetInputSchema(ds);

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
    });
    const timingMs = Date.now() - start;

    // Meta — opt in via the `includeMeta` input field or the x-include-meta header.
    const includeMeta = input.includeMeta === true
      || ctx.request?.headers?.['x-include-meta'] === 'true';

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
    middlewares: (resolved.middlewares ?? []) as ServeMiddleware<any, any, any, TAuth>[],
    auth: resolved.auth ?? null,
    tenant: resolved.tenant,
    metadata,
    cacheTtlMs: resolved.cache ?? null,
    defaultHeaders: undefined,
    requiredRoles: resolved.requiredRoles,
    requiredScopes: resolved.requiredScopes,
  };
}
