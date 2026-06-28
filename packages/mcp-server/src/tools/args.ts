import { z } from 'zod';
import { SEMANTIC_FILTER_OPERATORS, type MetricFilter } from '@hypequery/datasets';
import { MAX_QUERY_LIMIT } from '../types.js';

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
  dimensions: z.array(z.string().min(1)).optional(),
  filters: z.array(filterSchema).optional(),
  grain: z.enum(['day', 'week', 'month', 'quarter', 'year']).optional(),
  orderBy: z.array(orderBySchema).optional(),
  limit: z.number().int().nonnegative().max(MAX_QUERY_LIMIT).optional(),
  offset: z.number().int().nonnegative().optional(),
}).strict();

export const queryMetricArgsSchema = baseQuerySchema.extend({
  dataset: z.string().min(1).optional(),
  metric: z.string().min(1).optional(),
});

export const queryDatasetArgsSchema = baseQuerySchema.extend({
  dataset: z.string().min(1).optional(),
  measures: z.array(z.string().min(1)).optional(),
});

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map(issue => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'arguments';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

export function parseToolArgs<T>(schema: z.ZodType<T>, toolName: string, args: unknown): T {
  const result = schema.safeParse(args);
  if (!result.success) {
    throw new Error(`Invalid ${toolName} arguments: ${formatZodError(result.error)}`);
  }
  return result.data;
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
