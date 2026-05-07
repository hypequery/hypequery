/**
 * Converts a DatasetInstance into a standard ServeEndpoint for semantic queries.
 *
 * The generated endpoint is a POST handler that:
 * - Accepts dimensions, measures, filters, orderBy, limit, offset, by
 * - Validates requested dimensions/measures/filters against the dataset contract
 * - Executes via QueryBuilderFactoryLike
 * - Auto-injects tenant filtering if dataset.tenantKey is set
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
} from '../../types.js';
import type { DatasetInstance, FieldType, MetricFilter, MeasureDefinition, TimeGrain } from './types.js';
import type { QueryBuilderFactoryLike } from './query-builder-protocol.js';

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
  | DatasetInstance<any>
  | {
      dataset: DatasetInstance<any>;
      auth?: AuthStrategy<TAuth> | null;
      cache?: number | null;
      requiredRoles?: string[];
      requiredScopes?: string[];
      maxLimit?: number;
    };

function resolveDatasetEntry<TAuth extends AuthContext>(
  entry: DatasetEntry<TAuth>,
): {
  dataset: DatasetInstance<any>;
  auth?: AuthStrategy<TAuth> | null;
  cache?: number | null;
  requiredRoles?: string[];
  requiredScopes?: string[];
  maxLimit?: number;
} {
  if (entry && typeof entry === 'object' && '__type' in entry && entry.__type === 'dataset') {
    return { dataset: entry as DatasetInstance<any> };
  }
  return entry as {
    dataset: DatasetInstance<any>;
    auth?: AuthStrategy<TAuth> | null;
    cache?: number | null;
    requiredRoles?: string[];
    requiredScopes?: string[];
    maxLimit?: number;
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function matchesFieldType(fieldType: FieldType, value: unknown): boolean {
  switch (fieldType) {
    case 'string':
    case 'timestamp':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    default:
      return false;
  }
}

function validateFilterValue(filter: MetricFilter, fieldType: FieldType): string | null {
  switch (filter.operator) {
    case 'eq':
    case 'neq':
      return matchesFieldType(fieldType, filter.value)
        ? null
        : `"${filter.operator}" expects a ${fieldType} value for field "${filter.field}".`;
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      if (fieldType === 'boolean') {
        return `"${filter.operator}" is not supported for boolean field "${filter.field}".`;
      }
      return matchesFieldType(fieldType, filter.value)
        ? null
        : `"${filter.operator}" expects a ${fieldType} value for field "${filter.field}".`;
    case 'like':
      if (fieldType !== 'string' && fieldType !== 'timestamp') {
        return `"like" is only supported for string or timestamp field "${filter.field}".`;
      }
      return typeof filter.value === 'string'
        ? null
        : `"like" expects a string value for field "${filter.field}".`;
    case 'in':
    case 'notIn':
      if (!Array.isArray(filter.value) || filter.value.length === 0) {
        return `"${filter.operator}" expects a non-empty array for field "${filter.field}".`;
      }
      return filter.value.every(value => matchesFieldType(fieldType, value))
        ? null
        : `"${filter.operator}" expects ${fieldType} values for field "${filter.field}".`;
    case 'between':
      if (!Array.isArray(filter.value) || filter.value.length !== 2) {
        return `"between" expects a two-item array for field "${filter.field}".`;
      }
      return filter.value.every(value => matchesFieldType(fieldType, value))
        ? null
        : `"between" expects ${fieldType} values for field "${filter.field}".`;
    default:
      return null;
  }
}

function validateDatasetQuery(
  ds: DatasetInstance<any>,
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
  const filterNames = Object.keys(ds.filters);
  const selectedMeasures = query.measures ?? measureNames;
  const orderableFields = new Set<string>([
    ...(query.dimensions ?? []),
    ...selectedMeasures,
    ...(query.by ? ['period'] : []),
  ]);

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

const GRAIN_FUNCTIONS: Record<TimeGrain, string> = {
  day: 'toStartOfDay',
  week: 'toStartOfWeek',
  month: 'toStartOfMonth',
  quarter: 'toStartOfQuarter',
  year: 'toStartOfYear',
};

function applyMeasure(
  builder: ReturnType<QueryBuilderFactoryLike['table']>,
  name: string,
  definition: MeasureDefinition,
) {
  switch (definition.aggregation) {
    case 'sum':
      return builder.sum(definition.field, name);
    case 'count':
      return builder.count(definition.field, name);
    case 'countDistinct':
      return builder.countDistinct(definition.field, name);
    case 'avg':
      return builder.avg(definition.field, name);
    case 'min':
      return builder.min(definition.field, name);
    case 'max':
      return builder.max(definition.field, name);
    default:
      throw new Error(`Unsupported measure aggregation: ${definition.aggregation}`);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createDatasetEndpoint<TAuth extends AuthContext>(
  name: string,
  entry: DatasetEntry<TAuth>,
  builderFactory: QueryBuilderFactoryLike,
  blockMaxLimit?: number,
): ServeEndpoint<typeof datasetQueryInputSchema, typeof datasetResultSchema, any, TAuth, any> {
  const resolved = resolveDatasetEntry(entry);
  const ds = resolved.dataset;
  const dimensionNames = Object.keys(ds.dimensions);
  const measureNames = Object.keys(ds.measures);
  const effectiveMaxLimit = resolved.maxLimit ?? blockMaxLimit ?? ds.limits?.maxResultSize ?? 1000;

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
      tenantHandledInternally: true,
    },
  };

  const handler: EndpointHandler<any, any, any, TAuth> = async (ctx) => {
    const input = ctx.input ?? {};
    const start = Date.now();

    // Validate
    const validation = validateDatasetQuery(ds, input, effectiveMaxLimit);
    if (!validation.valid) {
      const error = new Error(validation.errors.join('; ')) as any;
      error.status = 400;
      error.payload = {
        type: 'VALIDATION_ERROR' as const,
        message: validation.errors.join('; '),
        details: { errors: validation.errors },
      };
      throw error;
    }

    // Build query
    let builder = builderFactory.table(ds.source);

    const dimensions = input.dimensions ?? [];
    const measures = input.measures ?? measureNames;
    const grain = input.by as TimeGrain | undefined;

    const selectParts: string[] = [];
    const groupByParts: string[] = [];

    if (grain) {
      const fn = GRAIN_FUNCTIONS[grain];
      selectParts.push(`${fn}(${ds.timeKey}) AS period`);
      groupByParts.push('period');
    }

    for (const dimensionName of dimensions) {
      const definition = ds.dimensions[dimensionName];
      const expression = definition?.sql ?? definition?.column ?? dimensionName;
      if (expression === dimensionName) {
        selectParts.push(dimensionName);
      } else {
        selectParts.push(`${expression} AS ${dimensionName}`);
      }
      groupByParts.push(dimensionName);
    }

    if (selectParts.length > 0) {
      builder = builder.select(selectParts);
    }

    for (const measureName of measures) {
      const definition = ds.measures[measureName];
      builder = applyMeasure(builder, measureName, definition);
    }

    if (groupByParts.length > 0) {
      builder = builder.groupBy(groupByParts);
    }

    // Tenant injection
    if (ds.tenantKey && ctx.tenantId) {
      builder = builder.where(ds.tenantKey, 'eq', ctx.tenantId);
    }

    // User filters
    if (input.filters) {
      for (const filter of input.filters) {
        const resolvedField = ds.filters[filter.field]?.field ?? filter.field;
        builder = builder.where(resolvedField, filter.operator, filter.value);
      }
    }

    // Order
    if (input.orderBy) {
      for (const ob of input.orderBy) {
        builder = builder.orderBy(ob.field, ob.direction.toUpperCase() as 'ASC' | 'DESC');
      }
    } else if (grain) {
      builder = builder.orderBy('period', 'ASC');
    }

    // Pagination
    const limit = Math.min(input.limit ?? effectiveMaxLimit, effectiveMaxLimit);
    builder = builder.limit(limit);
    if (input.offset) {
      builder = builder.offset(input.offset);
    }

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
    tenant: undefined,
    metadata,
    cacheTtlMs: resolved.cache ?? null,
    defaultHeaders: undefined,
    requiredRoles: resolved.requiredRoles,
    requiredScopes: resolved.requiredScopes,
  };
}

function buildDescription(ds: DatasetInstance<any>, maxLimit: number): string {
  const dimensionNames = Object.keys(ds.dimensions);
  const measureNames = Object.keys(ds.measures);
  const lines = [
    `Query the ${ds.name} semantic dataset (source: ${ds.source}).`,
    '',
    `**Dimensions:** ${dimensionNames.join(', ') || 'none'}`,
    `**Measures:** ${measureNames.join(', ') || 'none'}`,
    `**Max limit:** ${maxLimit}`,
  ];

  if (ds.tenantKey) {
    lines.push(`**Tenant scoped:** yes (${ds.tenantKey})`);
  }

  return lines.join('\n');
}
