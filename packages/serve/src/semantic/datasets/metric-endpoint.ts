/**
 * Converts a MetricRef into a standard ServeEndpoint.
 *
 * The generated endpoint is a POST handler that:
 * - Validates dimensions/filters against the metric's contract
 * - Calls MetricExecutor.run() with the parsed query + tenant context
 * - Returns { data } or { data, meta } based on headers
 */

import { z } from 'zod';
import type {
  AuthContext,
  AuthStrategy,
  EndpointHandler,
  EndpointMetadata,
  MetricEntry,
  ServeEndpoint,
  ServeMiddleware,
} from '../../types.js';
import type { MetricRef } from './types.js';
import { MetricExecutor } from './executor.js';

// ---------------------------------------------------------------------------
// Zod schemas for metric query input / output
// ---------------------------------------------------------------------------

const metricFilterSchema = z.object({
  field: z.string(),
  operator: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn', 'between', 'like']),
  value: z.unknown(),
});

const metricOrderBySchema = z.object({
  field: z.string(),
  direction: z.enum(['asc', 'desc']),
});

const metricQueryInputSchema = z.object({
  dimensions: z.array(z.string()).optional(),
  filters: z.array(metricFilterSchema).optional(),
  orderBy: z.array(metricOrderBySchema).optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
  by: z.enum(['day', 'week', 'month', 'quarter', 'year']).optional(),
});

const metricResultMetaSchema = z.object({
  timingMs: z.number().optional(),
  sql: z.string().optional(),
  tenant: z.string().optional(),
}).optional();

const metricResultSchema = z.object({
  data: z.array(z.record(z.unknown())),
  meta: metricResultMetaSchema,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveMetricEntry<TAuth extends AuthContext>(
  entry: MetricEntry<TAuth>,
): {
  metric: MetricRef<any, any>;
  auth?: AuthStrategy<TAuth> | null;
  cache?: number | null;
  requiredRoles?: string[];
  requiredScopes?: string[];
} {
  if (entry && typeof entry === 'object' && '__type' in entry && entry.__type === 'metric_ref') {
    return { metric: entry as MetricRef<any, any> };
  }
  return entry as {
    metric: MetricRef<any, any>;
    auth?: AuthStrategy<TAuth> | null;
    cache?: number | null;
    requiredRoles?: string[];
    requiredScopes?: string[];
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createMetricEndpoint<TAuth extends AuthContext>(
  name: string,
  entry: MetricEntry<TAuth>,
  executor: MetricExecutor,
): ServeEndpoint<typeof metricQueryInputSchema, typeof metricResultSchema, any, TAuth, any> {
  const resolved = resolveMetricEntry(entry);
  const metricRef = resolved.metric;
  const contract = metricRef.contract();

  const metadata: EndpointMetadata = {
    path: '', // filled by router.register
    method: 'POST',
    name: contract.label ?? name,
    summary: `Query the "${name}" metric`,
    description: buildDescription(contract),
    tags: ['metrics'],
    requiresAuth: resolved.auth !== null ? undefined : false,
    requiredRoles: resolved.requiredRoles,
    requiredScopes: resolved.requiredScopes,
    cacheTtlMs: resolved.cache,
    visibility: 'public',
  };

  const handler: EndpointHandler<any, any, any, TAuth> = async (ctx) => {
    const input = ctx.input ?? {};

    // Build the metric query
    const query = {
      dimensions: input.dimensions,
      filters: input.filters,
      orderBy: input.orderBy,
      limit: input.limit,
      offset: input.offset,
      by: input.by,
    };

    // Validate against contract
    const validation = executor.validate(metricRef, query);
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

    // Execute with tenant context
    const result = await executor.run(metricRef, query, {
      tenantId: ctx.tenantId,
    });

    // Decide whether to include meta
    const includeMeta = ctx.request?.headers?.['x-include-meta'] === 'true';

    return {
      data: result.data,
      meta: includeMeta ? result.meta : undefined,
    };
  };

  return {
    key: name,
    method: 'POST',
    inputSchema: metricQueryInputSchema,
    outputSchema: metricResultSchema,
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

function buildDescription(contract: ReturnType<MetricRef['contract']>): string {
  const lines = [
    contract.description ?? `${contract.name} metric on the ${contract.dataset} dataset.`,
    '',
    `**Type:** ${contract.kind}`,
    `**Dataset:** ${contract.dataset}`,
    `**Dimensions:** ${contract.dimensions.join(', ') || 'none'}`,
  ];

  if (contract.grains.length > 0) {
    lines.push(`**Time grains:** ${contract.grains.join(', ')}`);
  }

  if (contract.requires && contract.requires.length > 0) {
    lines.push(`**Requires:** ${contract.requires.join(', ')}`);
  }

  if (contract.tenantScoped) {
    lines.push('**Tenant scoped:** yes');
  }

  return lines.join('\n');
}
