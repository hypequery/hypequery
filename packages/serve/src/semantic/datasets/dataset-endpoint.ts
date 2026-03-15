/**
 * Converts a DatasetInstance into a standard ServeEndpoint for row browsing.
 *
 * The generated endpoint is a POST handler that:
 * - Accepts columns, filters, orderBy, limit, offset
 * - Validates requested columns/filters against the dataset's field definitions
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
import type { DatasetInstance } from './types.js';
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
  columns: z.array(z.string()).optional(),
  filters: z.array(datasetFilterSchema).optional(),
  orderBy: z.array(datasetOrderBySchema).optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
});

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

function validateDatasetQuery(
  ds: DatasetInstance<any>,
  query: { columns?: string[]; filters?: Array<{ field: string }> },
  maxLimit?: number,
): ValidationResult {
  const errors: string[] = [];
  const fieldNames = Object.keys(ds.fields);

  if (query.columns) {
    const invalid = query.columns.filter(c => !fieldNames.includes(c));
    if (invalid.length > 0) {
      errors.push(`Unknown columns: ${invalid.join(', ')}. Available: ${fieldNames.join(', ')}`);
    }
  }

  if (query.filters) {
    const invalid = query.filters.filter(f => !fieldNames.includes(f.field));
    if (invalid.length > 0) {
      errors.push(`Unknown filter fields: ${invalid.map(f => f.field).join(', ')}. Available: ${fieldNames.join(', ')}`);
    }
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
  blockMaxLimit?: number,
): ServeEndpoint<typeof datasetQueryInputSchema, typeof datasetResultSchema, any, TAuth, any> {
  const resolved = resolveDatasetEntry(entry);
  const ds = resolved.dataset;
  const fieldNames = Object.keys(ds.fields);
  const effectiveMaxLimit = resolved.maxLimit ?? blockMaxLimit ?? ds.limits?.maxResultSize ?? 1000;

  const metadata: EndpointMetadata = {
    path: '', // filled by router.register
    method: 'POST',
    name: name,
    summary: `Query the "${name}" dataset`,
    description: buildDescription(ds, effectiveMaxLimit),
    tags: ['datasets'],
    requiresAuth: resolved.auth !== null ? undefined : false,
    requiredRoles: resolved.requiredRoles,
    requiredScopes: resolved.requiredScopes,
    cacheTtlMs: resolved.cache,
    visibility: 'public',
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

    // Select columns (default: all fields)
    const columns = input.columns ?? fieldNames;
    builder = builder.select(columns);

    // Tenant injection
    if (ds.tenantKey && ctx.tenantId) {
      builder = builder.where(ds.tenantKey, 'eq', ctx.tenantId);
    }

    // User filters
    if (input.filters) {
      for (const filter of input.filters) {
        builder = builder.where(filter.field, filter.operator, filter.value);
      }
    }

    // Order
    if (input.orderBy) {
      for (const ob of input.orderBy) {
        builder = builder.orderBy(ob.field, ob.direction.toUpperCase() as 'ASC' | 'DESC');
      }
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
  const fieldNames = Object.keys(ds.fields);
  const lines = [
    `Browse rows from the ${ds.name} dataset (source: ${ds.source}).`,
    '',
    `**Columns:** ${fieldNames.join(', ')}`,
    `**Max limit:** ${maxLimit}`,
  ];

  if (ds.tenantKey) {
    lines.push(`**Tenant scoped:** yes (${ds.tenantKey})`);
  }

  return lines.join('\n');
}
