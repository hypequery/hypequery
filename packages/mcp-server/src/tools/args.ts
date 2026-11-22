import { z } from 'zod';
import {
  SEMANTIC_FILTER_OPERATORS,
  SUPPORTED_TIME_GRAINS,
  type DatasetFilterNode,
  type MetricFilter,
  type TimeGrain,
} from '@hypequery/datasets';
import { MCPToolError } from '../errors.js';
import { formatArgumentIssues } from './utils/argument-errors.js';
import { argumentsTooDeep } from './utils/argument-depth.js';
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
  return formatArgumentIssues(error.issues).join('; ');
}

// Canonical schemas are built per catalog, so their parsed type is not known
// statically; callers name it, as Zod 3's `ZodTypeAny` used to imply `any`.
export function parseToolArgs<T = any>(schema: z.ZodType, toolName: string, args: unknown): T {
  // Filter groups and formulas nest, and a schema that refers to itself
  // descends as deep as the input does, so depth is bounded before parsing.
  if (argumentsTooDeep(args)) {
    throw new MCPToolError('MCP_INVALID_ARGUMENTS', `Invalid ${toolName} arguments: arguments are nested too deeply`);
  }
  const result = schema.safeParse(args);
  if (!result.success) {
    throw new MCPToolError(
      'MCP_INVALID_ARGUMENTS',
      `Invalid ${toolName} arguments: ${formatZodError(result.error)}`,
    );
  }
  return result.data as T;
}

type ToolFilter = { field: string; operator: MetricFilter['operator']; value?: unknown };
type ToolFilterNode = ToolFilter | { and: ToolFilterNode[] } | { or: ToolFilterNode[] } | { not: ToolFilterNode };

/**
 * Parsed tool filters as dataset client filters, groups included (RFC 0029).
 * A null check (RFC 0023) carries no value, so none is copied onto it.
 */
export function toMetricFilters(filters: ToolFilterNode[] = []): DatasetFilterNode[] {
  return filters.map(toFilterNode);
}

function toFilterNode(node: ToolFilterNode): DatasetFilterNode {
  if ('and' in node) return { and: node.and.map(toFilterNode) };
  if ('or' in node) return { or: node.or.map(toFilterNode) };
  if ('not' in node) return { not: toFilterNode(node.not) };
  return (node.value === undefined
    ? { field: node.field, operator: node.operator }
    : { field: node.field, operator: node.operator, value: node.value }) as MetricFilter;
}
