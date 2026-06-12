/**
 * Builds per-dataset / per-metric Zod input schemas whose dimension, measure,
 * filter, and orderBy fields are constrained to the names the semantic
 * validators accept. This upgrades the generated OpenAPI/docs from "array of
 * arbitrary strings" to enumerated fields and enables typed client codegen.
 *
 * The enums are deliberately a *superset-safe* mirror of the runtime validators
 * (`validateDatasetQueryInput` / the metric `validateQuery`): they never reject
 * a field the validator would accept. Where a list would be empty (e.g. a
 * dataset with no declared filters) we fall back to `z.string()` and let the
 * validator produce the precise error, rather than emitting an empty enum.
 */

import { z } from 'zod';
import type { AnyDatasetInstance } from '@hypequery/datasets';

const OPERATORS = [
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn', 'between', 'like',
] as const;

const GRAINS = ['day', 'week', 'month', 'quarter', 'year'] as const;

/** An enum over the given field names, or a plain string when none are known. */
function fieldEnum(values: string[]): z.ZodTypeAny {
  const unique = Array.from(new Set(values));
  return unique.length > 0
    ? z.enum(unique as [string, ...string[]])
    : z.string();
}

function filterSchema(fieldNames: string[]) {
  return z.object({
    field: fieldEnum(fieldNames),
    operator: z.enum(OPERATORS),
    value: z.unknown(),
  });
}

function orderBySchema(fieldNames: string[]) {
  return z.object({
    field: fieldEnum(fieldNames),
    direction: z.enum(['asc', 'desc']),
  });
}

/** Apply a `.max()` bound only when the dataset declares one. */
function boundedArray(item: z.ZodTypeAny, max?: number) {
  const arr = z.array(item);
  return (max != null ? arr.max(max) : arr).optional();
}

/**
 * Input schema for a dataset query endpoint, mirroring
 * `validateDatasetQueryInput`.
 */
export function buildDatasetInputSchema(ds: AnyDatasetInstance) {
  const dimensionNames = Object.keys(ds.dimensions);
  const measureNames = Object.keys(ds.measures);
  // Dataset filters are keyed by filter-definition name (no dimension fallback).
  const filterNames = Object.keys(ds.filters);
  // orderBy is query-dependent at runtime; the static superset is every
  // dimension/measure plus the synthetic `period` column when grained.
  const orderableNames = [...dimensionNames, ...measureNames, 'period'];

  return z.object({
    dimensions: boundedArray(fieldEnum(dimensionNames), ds.limits?.maxDimensions),
    measures: boundedArray(fieldEnum(measureNames), ds.limits?.maxMeasures),
    filters: boundedArray(filterSchema(filterNames), ds.limits?.maxFilters),
    orderBy: z.array(orderBySchema(orderableNames)).optional(),
    limit: z.number().int().positive().optional(),
    offset: z.number().int().nonnegative().optional(),
    by: z.enum(GRAINS).optional(),
    includeMeta: z.boolean().optional(),
  }).strict();
}

/**
 * Input schema for a metric query endpoint, mirroring the metric `validateQuery`.
 * Metrics select a single value, so there is no `measures` field; `orderBy` may
 * reference the metric's own output column (`metricName`).
 */
export function buildMetricInputSchema(ds: AnyDatasetInstance, metricName: string) {
  const dimensionNames = Object.keys(ds.dimensions);
  // Metric validator falls back to dimension names when no filters are declared.
  const filterNames = Object.keys(ds.filters).length > 0
    ? Object.keys(ds.filters)
    : dimensionNames;
  const orderableNames = [...dimensionNames, metricName, 'period'];

  return z.object({
    dimensions: boundedArray(fieldEnum(dimensionNames), ds.limits?.maxDimensions),
    filters: boundedArray(filterSchema(filterNames), ds.limits?.maxFilters),
    orderBy: z.array(orderBySchema(orderableNames)).optional(),
    limit: z.number().int().positive().optional(),
    offset: z.number().int().nonnegative().optional(),
    by: z.enum(GRAINS).optional(),
    includeMeta: z.boolean().optional(),
  });
}
