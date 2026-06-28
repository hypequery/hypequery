/**
 * Converts a MetricRef into a standard ServeEndpoint.
 *
 * The generated endpoint is a POST handler that:
 * - Validates dimensions/filters against the metric's contract
 * - Calls DatasetClient.execute() with the parsed query + tenant context
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
  TenantConfigOverride,
} from '../../types.js';
import type { AnyDatasetInstance, DatasetClient, MetricContract, MetricHandle, QueryBuilderFactoryLike } from '@hypequery/datasets';
import { ServeHttpError } from '../../errors.js';
import {
  resolveSemanticExecutionRuntime,
  resolveSemanticQueryBuilder,
} from '../query-builder-context.js';
import { buildMetricInputSchema } from './utils/semantic-input-schema.js';

// ---------------------------------------------------------------------------
// Zod schemas for metric query input / output
// ---------------------------------------------------------------------------

const metricResultMetaSchema = z.object({
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

const metricResultSchema = z.object({
  data: z.array(z.record(z.unknown())),
  meta: metricResultMetaSchema,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MetricEntryOptions<TAuth extends AuthContext> = Exclude<MetricEntry<TAuth>, MetricHandle<any, any>>;

function isMetricHandleEntry<TAuth extends AuthContext>(
  entry: MetricEntry<TAuth>,
): entry is MetricHandle<any, any> {
  return (
    !!entry &&
    typeof entry === 'object' &&
    '__type' in entry &&
    (entry.__type === 'metric_ref' || entry.__type === 'grained_metric_ref')
  );
}

function isMetricEntryOptions<TAuth extends AuthContext>(
  entry: MetricEntry<TAuth>,
): entry is MetricEntryOptions<TAuth> {
  return !!entry && typeof entry === 'object' && 'metric' in entry;
}

export function resolveMetricEntry<TAuth extends AuthContext>(
  entry: MetricEntry<TAuth>,
): {
  metric: MetricHandle<any, any>;
  auth?: AuthStrategy<TAuth> | null;
  tenant?: TenantConfigOverride<TAuth>;
  cache?: number | null;
  requiredRoles?: string[];
  requiredScopes?: string[];
  middlewares?: ServeMiddleware<any, any, any, TAuth>[];
  maxLimit?: number;
} {
  if (isMetricHandleEntry(entry)) {
    return { metric: entry };
  }

  if (isMetricEntryOptions(entry)) {
    return entry;
  }

  throw new Error('Invalid metric entry.');
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createMetricEndpoint<TAuth extends AuthContext>(
  name: string,
  entry: MetricEntry<TAuth>,
  analytics: DatasetClient,
  defaultBuilderFactory: QueryBuilderFactoryLike,
): ServeEndpoint<z.ZodTypeAny, typeof metricResultSchema, any, TAuth, any> {
  const resolved = resolveMetricEntry(entry);
  const metricRef = resolved.metric;
  const contract = metricRef.contract();
  // The metric's underlying dataset, used to enumerate valid query fields and
  // page-size defaults.
  const ds = (
    metricRef.__type === 'metric_ref' ? metricRef.dataset : metricRef.metric.dataset
  ) as AnyDatasetInstance;
  const metricQueryInputSchema = buildMetricInputSchema(ds, contract.name);
  // Page-size cap, mirroring datasets: clamp (don't reject) and apply a default
  // so a metric query is never unbounded.
  const effectiveMaxLimit = resolved.maxLimit ?? ds.limits?.maxResultSize ?? 1000;

  const metadata: EndpointMetadata = {
    path: '', // filled by router.register
    method: 'POST',
    name: contract.label ?? name,
    summary: `Query the "${name}" metric`,
    description: buildDescription(contract, effectiveMaxLimit),
    tags: ['metrics'],
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
    const runtime = resolveSemanticExecutionRuntime(semanticContext);
    const runtimeBuilderFactory = resolveSemanticQueryBuilder(
      semanticContext,
      defaultBuilderFactory,
    );
    // Build the metric query
    const query = {
      dimensions: input.dimensions,
      filters: input.filters,
      orderBy: input.orderBy,
      limit: Math.min(input.limit ?? effectiveMaxLimit, effectiveMaxLimit),
      offset: input.offset,
      by: input.by,
    };

    if (ctx.tenantId && !runtime?.tenant) {
      throw new ServeHttpError(
        500,
        'INTERNAL_SERVER_ERROR',
        `Metric endpoint "${name}" requires serve tenant runtime when tenant isolation is enabled.`,
      );
    }

    const validationContext = ctx.tenantId && runtime?.tenant
      ? {
          runtime: {
            tenant: runtime.tenant,
          },
        }
      : undefined;
    const validation = analytics.validate(metricRef, query, validationContext);
    if (!validation.valid) {
      throw new ServeHttpError(
        400,
        'VALIDATION_ERROR',
        validation.errors.join('; ')
      );
    }

    // Execute with tenant context
    const result = await analytics.execute(metricRef, query, {
      runtime: {
        ...runtime,
        builderFactory: runtimeBuilderFactory,
        tenant: runtime?.tenant,
      },
    });

    // Decide whether to include meta — `includeMeta` input field or x-include-meta header.
    const includeMeta = input.includeMeta === true
      || ctx.request?.headers?.['x-include-meta'] === 'true';

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

function buildDescription(contract: MetricContract, maxLimit: number): string {
  const lines = [
    contract.description ?? `${contract.name} metric on the ${contract.dataset} dataset.`,
    '',
    `**Type:** ${contract.kind}`,
    `**Dataset:** ${contract.dataset}`,
    `**Dimensions:** ${contract.dimensions.join(', ') || 'none'}`,
    `**Max limit:** ${maxLimit}`,
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
