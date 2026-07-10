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
import {
  getDatasetCatalog,
  getQueryableRelationshipFields,
  SEMANTIC_FILTER_OPERATORS,
  type AnyDatasetInstance,
  type DatasetCatalog,
} from '@hypequery/datasets';

/** An enum over the given field names, or a plain string when none are known. */
function fieldEnum(values: string[]): z.ZodTypeAny {
  const unique = Array.from(new Set(values));
  return unique.length > 0
    ? z.enum(unique as [string, ...string[]])
    : z.string();
}

function grainEnum(catalog: DatasetCatalog): z.ZodTypeAny {
  return fieldEnum(catalog.supportedGrains);
}

function filterSchema(fieldNames: string[]) {
  return z.object({
    field: fieldEnum(fieldNames),
    operator: z.enum(SEMANTIC_FILTER_OPERATORS),
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
  const catalog = getDatasetCatalog(ds);
  const dimensionNames = [
    ...Object.keys(catalog.dimensions),
    ...getQueryableRelationshipFields(catalog),
  ];
  const measureNames = Object.keys(catalog.measures);
  // Dataset runtime (`validateDatasetQueryInput`) rejects any non-relationship
  // field not in `catalog.filters`, so mirror that exactly (no dimension fallback).
  const filterFieldNames = [
    ...Object.keys(catalog.filters),
    ...getQueryableRelationshipFields(catalog),
  ];

  return z.object({
    dimensions: boundedArray(fieldEnum(dimensionNames), ds.limits?.maxDimensions),
    measures: boundedArray(fieldEnum(measureNames), ds.limits?.maxMeasures),
    filters: boundedArray(filterSchema(filterFieldNames), ds.limits?.maxFilters),
    orderBy: z.array(orderBySchema(catalog.orderableFields)).optional(),
    limit: z.number().int().positive().optional(),
    offset: z.number().int().nonnegative().optional(),
    by: grainEnum(catalog).optional(),
    includeMeta: z.boolean().optional(),
  }).strict();
}

/**
 * Input schema for a metric query endpoint, mirroring the metric `validateQuery`.
 * Metrics select a single value, so there is no `measures` field; `orderBy` may
 * reference the metric's own output column (`metricName`).
 */
export function buildMetricInputSchema(ds: AnyDatasetInstance, metricName: string) {
  const catalog = getDatasetCatalog(ds);
  const dimensionNames = [
    ...Object.keys(catalog.dimensions),
    ...getQueryableRelationshipFields(catalog),
  ];
  const orderableNames = [
    ...dimensionNames,
    metricName,
    ...(catalog.timeKey ? ['period'] : []),
  ];
  // Metric runtime (`validateQuery`) falls back to all dimensions as valid
  // filter fields when the dataset declares no filters — mirror that fallback so
  // the schema never rejects a local-dimension filter the runtime would accept.
  const declaredFilters = Object.keys(catalog.filters);
  const filterFieldNames = [
    ...(declaredFilters.length > 0 ? declaredFilters : Object.keys(catalog.dimensions)),
    ...getQueryableRelationshipFields(catalog),
  ];

  return z.object({
    dimensions: boundedArray(fieldEnum(dimensionNames), ds.limits?.maxDimensions),
    filters: boundedArray(filterSchema(filterFieldNames), ds.limits?.maxFilters),
    orderBy: z.array(orderBySchema(orderableNames)).optional(),
    limit: z.number().int().positive().optional(),
    offset: z.number().int().nonnegative().optional(),
    by: grainEnum(catalog).optional(),
    includeMeta: z.boolean().optional(),
  });
}
