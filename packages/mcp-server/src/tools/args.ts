/**
 * Zod schemas and parsing for MCP tool arguments.
 *
 * Tool arguments arrive untyped from MCP clients, so they are validated here
 * before use. `dataset`/`metric` are kept optional in the schemas so the tools
 * can raise their existing, more specific "<x> parameter is required" /
 * "Dataset not found" errors; the schemas focus on validating the *shape* of
 * the structured fields (filters, orderBy, grain, limit).
 */

import { z } from 'zod';
import type { QueryMetricArgs, QueryDatasetArgs, GetDatasetSchemaArgs } from '../types.js';

const filterOperatorSchema = z.enum([
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn', 'between', 'like',
]);

const filterSchema = z.object({
  field: z.string().min(1),
  operator: filterOperatorSchema,
  value: z.unknown(),
});

const orderBySchema = z.object({
  field: z.string().min(1),
  direction: z.enum(['asc', 'desc']),
});

const grainSchema = z.enum(['day', 'week', 'month', 'quarter', 'year']);

const queryMetricSchema = z.object({
  dataset: z.string().optional(),
  metric: z.string().optional(),
  dimensions: z.array(z.string()).optional(),
  filters: z.array(filterSchema).optional(),
  grain: grainSchema.optional(),
  orderBy: z.array(orderBySchema).optional(),
  limit: z.number().int().nonnegative().optional(),
});

const queryDatasetSchema = z.object({
  dataset: z.string().optional(),
  dimensions: z.array(z.string()).optional(),
  metrics: z.array(z.string()).optional(),
  filters: z.array(filterSchema).optional(),
  grain: grainSchema.optional(),
  orderBy: z.array(orderBySchema).optional(),
  limit: z.number().int().nonnegative().optional(),
});

const getDatasetSchemaSchema = z.object({
  dataset: z.string().optional(),
});

/**
 * Validate `args` against `schema`, throwing a readable error on failure.
 */
function parseToolArgs<T>(schema: z.ZodType<T>, args: unknown): T {
  const result = schema.safeParse(args ?? {});
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid arguments: ${detail}`);
  }
  return result.data;
}

export function parseQueryMetricArgs(args: unknown): QueryMetricArgs {
  return parseToolArgs(queryMetricSchema, args) as QueryMetricArgs;
}

export function parseQueryDatasetArgs(args: unknown): QueryDatasetArgs {
  return parseToolArgs(queryDatasetSchema, args) as QueryDatasetArgs;
}

export function parseGetDatasetSchemaArgs(args: unknown): GetDatasetSchemaArgs {
  return parseToolArgs(getDatasetSchemaSchema, args) as GetDatasetSchemaArgs;
}
