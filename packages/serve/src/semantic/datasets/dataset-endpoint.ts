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
  AuthStrategy,
  EndpointHandler,
  EndpointMetadata,
  ServeEndpoint,
  ServeMiddleware,
  TenantConfigOverride,
} from '../../types.js';
import type {
  DatasetInstance,
  MetricFilter,
  TimeGrain,
  QueryBuilderFactoryLike,
  ValidationResult,
} from '@hypequery/datasets';
import {
  applyMeasureDefinition,
  appendOrderLimitOffset,
  buildDimensionSelectionPlan,
  resolveFilterField,
  validateFilterValue,
} from '@hypequery/datasets';
import { ServeHttpError } from '../../errors.js';
import {
  resolveSemanticExecutionRuntime,
  resolveSemanticQueryBuilder,
} from '../query-builder-context.js';

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
// Dataset entry types
// ---------------------------------------------------------------------------

/** Per-dataset entry: shorthand (just the instance) or with overrides. */
export type DatasetEntry<TAuth extends AuthContext = AuthContext> =
  | DatasetInstance
  | {
      dataset: DatasetInstance;
      auth?: AuthStrategy<TAuth> | null;
      tenant?: TenantConfigOverride<TAuth>;
      cache?: number | null;
      requiredRoles?: string[];
      requiredScopes?: string[];
      maxLimit?: number;
    };

function resolveDatasetEntry<TAuth extends AuthContext>(
  entry: DatasetEntry<TAuth>,
): {
  dataset: DatasetInstance;
  auth?: AuthStrategy<TAuth> | null;
  tenant?: TenantConfigOverride<TAuth>;
  cache?: number | null;
  requiredRoles?: string[];
  requiredScopes?: string[];
  maxLimit?: number;
} {
  if (entry && typeof entry === 'object' && '__type' in entry && entry.__type === 'dataset') {
    return { dataset: entry as DatasetInstance };
  }
  return entry as {
      dataset: DatasetInstance;
      auth?: AuthStrategy<TAuth> | null;
      tenant?: TenantConfigOverride<TAuth>;
      cache?: number | null;
      requiredRoles?: string[];
      requiredScopes?: string[];
      maxLimit?: number;
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateDatasetQuery(
  ds: DatasetInstance,
  query: {
    dimensions?: string[];
    measures?: string[];
    filters?: Array<{ field: string }>;
    orderBy?: Array<{ field: string }>;
    by?: TimeGrain;
  },
  maxLimit?: number,
): ValidationResult {
  const errors: string[] = [];
  const dimensionNames = Object.keys(ds.dimensions);
  const measureNames = Object.keys(ds.measures);
  const selectedDimensions = query.dimensions ?? [];
  const selectedMeasures = query.measures ?? measureNames;
  const filterNames = Object.keys(ds.filters);
  const orderableFields = new Set<string>([
    ...selectedDimensions,
    ...selectedMeasures,
    ...(query.by ? ['period'] : []),
  ]);

  if (selectedDimensions.length === 0 && selectedMeasures.length === 0) {
    errors.push(
      `Dataset "${ds.name}" query must select at least one dimension or measure.`,
    );
  }

  if (query.dimensions) {
    const invalid = query.dimensions.filter(c => !dimensionNames.includes(c));
    if (invalid.length > 0) {
      errors.push(`Unknown dimensions: ${invalid.join(', ')}. Available: ${dimensionNames.join(', ')}`);
    }
  }

  if (query.measures) {
    const invalid = query.measures.filter(c => !measureNames.includes(c));
    if (invalid.length > 0) {
      errors.push(`Unknown measures: ${invalid.join(', ')}. Available: ${measureNames.join(', ')}`);
    }
  }

  if (query.filters) {
    const invalid = query.filters.filter(f => !filterNames.includes(f.field));
    if (invalid.length > 0) {
      errors.push(`Unknown filter fields: ${invalid.map(f => f.field).join(', ')}. Available: ${filterNames.join(', ')}`);
    }

    for (const filter of query.filters) {
      const filterDefinition = ds.filters[filter.field];
      if (filterDefinition?.operators && !filterDefinition.operators.includes((filter as MetricFilter).operator)) {
        errors.push(
          `Filter "${filter.field}" does not allow operator "${(filter as MetricFilter).operator}". Allowed: ${filterDefinition.operators.join(', ')}`,
        );
        continue;
      }
      const resolvedField = ds.filters[filter.field]?.field ?? filter.field;
      const fieldType = ds.dimensions[resolvedField]?.fieldType;
      if (!fieldType) continue;
      const filterError = validateFilterValue(filter as MetricFilter, fieldType);
      if (filterError) {
        errors.push(filterError);
      }
    }
  }

  if (query.orderBy) {
    const invalid = query.orderBy.filter(o => !orderableFields.has(o.field));
    if (invalid.length > 0) {
      errors.push(`Unknown orderBy fields: ${invalid.map(o => o.field).join(', ')}. Available: ${Array.from(orderableFields).join(', ')}`);
    }
  }

  if (query.by && !ds.timeKey) {
    errors.push(`Cannot use "by" grain — dataset "${ds.name}" has no timeKey.`);
  }

  if (ds.limits?.maxDimensions && query.dimensions && query.dimensions.length > ds.limits.maxDimensions) {
    errors.push(`Too many dimensions: ${query.dimensions.length} (max ${ds.limits.maxDimensions})`);
  }

  if (ds.limits?.maxMeasures && query.measures && query.measures.length > ds.limits.maxMeasures) {
    errors.push(`Too many measures: ${query.measures.length} (max ${ds.limits.maxMeasures})`);
  }

  if (ds.limits?.maxFilters && query.filters && query.filters.length > ds.limits.maxFilters) {
    errors.push(`Too many filters: ${query.filters.length} (max ${ds.limits.maxFilters})`);
  }

  return { valid: errors.length === 0, errors };
}

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
    description: buildDescription(ds, effectiveMaxLimit),
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
    const validation = validateDatasetQuery(ds, input, effectiveMaxLimit);
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
      if (!runtime?.tenant) {
        throw new ServeHttpError(
          500,
          'INTERNAL_SERVER_ERROR',
          `Dataset endpoint "${name}" requires tenant.column in Serve tenant config when tenant isolation is enabled.`,
        );
      }
      if (!runtime.tenant.handledByBuilder) {
        builder = builder.where(runtime.tenant.column, 'eq', runtime.tenant.id);
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

function buildDescription(ds: DatasetInstance, maxLimit: number): string {
  const dimensionNames = Object.keys(ds.dimensions);
  const measureNames = Object.keys(ds.measures);
  const lines = [
    `Query the ${ds.name} semantic dataset (source: ${ds.source}).`,
    '',
    `**Dimensions:** ${dimensionNames.join(', ') || 'none'}`,
    `**Measures:** ${measureNames.join(', ') || 'none'}`,
    `**Max limit:** ${maxLimit}`,
  ];

  return lines.join('\n');
}
