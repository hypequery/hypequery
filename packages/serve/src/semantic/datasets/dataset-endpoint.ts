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
  TimeGrain,
  QueryBuilderFactoryLike,
} from '@hypequery/datasets';
import { ServeHttpError } from '../../errors.js';
import {
  resolveSemanticExecutionRuntime,
  resolveSemanticQueryBuilder,
  resolveSemanticTenantHandledByBuilder,
} from '../query-builder-context.js';
import {
  applyMeasureDefinition,
  appendOrderLimitOffset,
  buildDimensionSelectionPlan,
  resolveFilterField,
} from './query-planner.js';
import { buildDatasetQueryDescription } from './utils/dataset-query-metadata.js';
import { resolveDatasetEntry, type DatasetEntry } from './utils/dataset-entry.js';
import { validateDatasetQuery } from './utils/dataset-query-validation.js';

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
  const dimensionNames = Object.keys(ds.dimensions);
  const measureNames = Object.keys(ds.measures);
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
    const input = ctx.input ?? {};
    const start = Date.now();

    // Validate
    const validation = validateDatasetQuery(ds, input);
    if (!validation.valid) {
      throw new ServeHttpError(
        400,
        'VALIDATION_ERROR',
        validation.errors.join('; ')
      );
    }

    // Build query
    const runtimeBuilderFactory = resolveSemanticQueryBuilder(
      ctx as Record<string, unknown>,
      builderFactory,
    );
    const runtime = resolveSemanticExecutionRuntime(ctx as Record<string, unknown>);
    let builder = runtimeBuilderFactory.table(ds.source);

    const dimensions = input.dimensions ?? [];
    const measures = input.measures ?? measureNames;
    const grain = input.by as TimeGrain | undefined;
    const { selectParts, groupByParts } = buildDimensionSelectionPlan(
      ds,
      dimensions,
      grain,
    );

    if (selectParts.length > 0) {
      builder = builder.select(selectParts);
    }

    for (const measureName of measures) {
      const definition = ds.measures[measureName];
      builder = applyMeasureDefinition(builder, ds, measureName, definition);
    }

    if (groupByParts.length > 0) {
      builder = builder.groupBy(groupByParts);
    }

    // Tenant injection
    if (ctx.tenantId) {
      if (!runtime?.tenant || !ds.tenantKey) {
        throw new ServeHttpError(
          500,
          'INTERNAL_SERVER_ERROR',
          `Dataset endpoint "${name}" requires dataset tenantKey and serve tenant runtime when tenant isolation is enabled.`,
        );
      }
      if (!resolveSemanticTenantHandledByBuilder(ctx as Record<string, unknown>)) {
        builder = builder.where(ds.tenantKey, 'eq', runtime.tenant.id);
      }
    }

    // User filters
    if (input.filters) {
      for (const filter of input.filters) {
        const resolvedField = resolveFilterField(ds, filter.field);
        builder = builder.where(resolvedField, filter.operator, filter.value);
      }
    }

    // Order
    const limit = Math.min(input.limit ?? effectiveMaxLimit, effectiveMaxLimit);
    builder = appendOrderLimitOffset(
      builder,
      input.orderBy,
      grain,
      limit,
      input.offset,
    );

    // Execute
    const sqlInfo = builder.toSQLWithParams();
    const data = await builder.execute();
    const timingMs = Date.now() - start;

    // Meta
    const includeMeta = ctx.request?.headers?.['x-include-meta'] === 'true';

    return {
      data,
      meta: includeMeta ? {
        timingMs,
        sql: sqlInfo.sql,
        tenant: ctx.tenantId,
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
