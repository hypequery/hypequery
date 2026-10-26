import { z } from 'zod';
import {
  SEMANTIC_FILTER_OPERATORS,
  SUPPORTED_TIME_GRAINS,
  type MetricFilter,
  type TimeGrain,
} from '@hypequery/datasets';
import { MCPToolError } from '../errors.js';
import {
  MAX_QUERY_DIMENSIONS,
  MAX_QUERY_FILTERS,
  MAX_QUERY_LIMIT,
  MAX_QUERY_MEASURES,
  MAX_QUERY_OFFSET,
  MAX_QUERY_ORDER_BY,
} from '../types.js';

const filterSchema = z.object({
  field: z.string().min(1),
  operator: z.enum(SEMANTIC_FILTER_OPERATORS),
  value: z.any().refine(value => value !== undefined, 'Required'),
}).strict();

const orderBySchema = z.object({
  field: z.string().min(1),
  direction: z.enum(['asc', 'desc']),
}).strict();

const baseQuerySchema = z.object({
  dimensions: z.array(z.string().min(1)).max(MAX_QUERY_DIMENSIONS).optional(),
  filters: z.array(filterSchema).max(MAX_QUERY_FILTERS).optional(),
  // Each dataset narrows this to the segment names it declares.
  segments: z.array(z.string().min(1)).max(MAX_QUERY_FILTERS).optional(),
  // Each dataset narrows this further through its catalog `supportedGrains`.
  grain: z.enum(SUPPORTED_TIME_GRAINS as [TimeGrain, ...TimeGrain[]]).optional(),
  timezone: z.string().min(1).max(100).optional(),
  orderBy: z.array(orderBySchema).max(MAX_QUERY_ORDER_BY).optional(),
  limit: z.number().int().positive().max(MAX_QUERY_LIMIT).optional(),
  offset: z.number().int().nonnegative().max(MAX_QUERY_OFFSET).optional(),
}).strict();

export const queryMetricArgsSchema = baseQuerySchema.extend({
  dataset: z.string().min(1).optional(),
  metric: z.string().min(1).optional(),
});

export const queryDatasetArgsSchema = baseQuerySchema.extend({
  dataset: z.string().min(1).optional(),
  measures: z.array(z.string().min(1)).max(MAX_QUERY_MEASURES).optional(),
});

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map(issue => {
      const path = issue.path.length > 0 ? issue.path.map(String).join('.') : 'arguments';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

// Canonical schemas are built per catalog, so their parsed type is not known
// statically; callers name it, as Zod 3's `ZodTypeAny` used to imply `any`.
export function parseToolArgs<T = any>(schema: z.ZodType, toolName: string, args: unknown): T {
  const result = schema.safeParse(args);
  if (!result.success) {
    throw new MCPToolError(
      'MCP_INVALID_ARGUMENTS',
      `Invalid ${toolName} arguments: ${formatZodError(result.error)}`,
    );
  }
  return result.data as T;
}

export function toMetricFilters(
  filters: Array<{ field: string; operator: MetricFilter['operator']; value?: unknown }> = [],
): MetricFilter[] {
  return filters.map(filter => ({
    field: filter.field,
    operator: filter.operator,
    value: filter.value,
  }));
}
