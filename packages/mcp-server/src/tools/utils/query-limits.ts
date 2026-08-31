import type { DatasetLimits } from '@hypequery/datasets';
import {
  DEFAULT_QUERY_LIMIT,
  MAX_QUERY_DIMENSIONS,
  MAX_QUERY_FILTERS,
  MAX_QUERY_LIMIT,
  MAX_QUERY_MEASURES,
  MAX_QUERY_OFFSET,
  MAX_QUERY_ORDER_BY,
  type MCPQueryLimits,
} from '../../types.js';

interface QueryCollections {
  readonly dimensions?: readonly unknown[];
  readonly measures?: readonly unknown[];
  readonly filters?: readonly unknown[];
  readonly orderBy?: readonly unknown[];
  readonly limit?: number;
  readonly offset?: number;
}

export interface EffectiveQueryLimits {
  readonly defaultResultSize: number;
  readonly maxResultSize: number;
  readonly maxOffset: number;
  readonly maxDimensions: number;
  readonly maxMeasures: number;
  readonly maxFilters: number;
  readonly maxOrderBy: number;
}

function positiveInteger(value: number | undefined, fallback: number, maximum: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  }
  return resolved;
}

function datasetLimits(dataset: unknown): DatasetLimits | undefined {
  if (!dataset || typeof dataset !== 'object' || Array.isArray(dataset)) return undefined;
  const limits = (dataset as { limits?: unknown }).limits;
  return limits && typeof limits === 'object' && !Array.isArray(limits)
    ? limits as DatasetLimits
    : undefined;
}

function datasetPositiveInteger(value: number | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Dataset ${name} must be a positive integer`);
  }
  return value;
}

function lowerLimit(...values: Array<number | undefined>): number {
  return Math.min(...values.filter((value): value is number => value !== undefined));
}

export function resolveQueryLimits(
  dataset: unknown,
  configured: MCPQueryLimits = {},
): EffectiveQueryLimits {
  const semantic = datasetLimits(dataset);
  const maxResultSize = lowerLimit(
    positiveInteger(configured.maxResultSize, MAX_QUERY_LIMIT, MAX_QUERY_LIMIT, 'maxResultSize'),
    datasetPositiveInteger(semantic?.maxResultSize, 'maxResultSize'),
  );
  const defaultResultSize = lowerLimit(
    positiveInteger(
      configured.defaultResultSize,
      DEFAULT_QUERY_LIMIT,
      MAX_QUERY_LIMIT,
      'defaultResultSize',
    ),
    maxResultSize,
  );

  return Object.freeze({
    defaultResultSize,
    maxResultSize,
    maxOffset: positiveInteger(configured.maxOffset, MAX_QUERY_OFFSET, MAX_QUERY_OFFSET, 'maxOffset'),
    maxDimensions: lowerLimit(
      positiveInteger(configured.maxDimensions, MAX_QUERY_DIMENSIONS, MAX_QUERY_DIMENSIONS, 'maxDimensions'),
      datasetPositiveInteger(semantic?.maxDimensions, 'maxDimensions'),
    ),
    maxMeasures: lowerLimit(
      positiveInteger(configured.maxMeasures, MAX_QUERY_MEASURES, MAX_QUERY_MEASURES, 'maxMeasures'),
      datasetPositiveInteger(semantic?.maxMeasures, 'maxMeasures'),
    ),
    maxFilters: lowerLimit(
      positiveInteger(configured.maxFilters, MAX_QUERY_FILTERS, MAX_QUERY_FILTERS, 'maxFilters'),
      datasetPositiveInteger(semantic?.maxFilters, 'maxFilters'),
    ),
    maxOrderBy: positiveInteger(configured.maxOrderBy, MAX_QUERY_ORDER_BY, MAX_QUERY_ORDER_BY, 'maxOrderBy'),
  });
}

function assertCollectionLimit(
  values: readonly unknown[] | undefined,
  maximum: number,
  name: string,
): void {
  if ((values?.length ?? 0) > maximum) {
    throw new Error(`Invalid ${name}: maximum ${maximum} items`);
  }
}

export function applyQueryLimits(
  dataset: unknown,
  query: QueryCollections,
  configured: MCPQueryLimits = {},
): { readonly limit: number; readonly offset?: number } {
  const limits = resolveQueryLimits(dataset, configured);
  assertCollectionLimit(query.dimensions, limits.maxDimensions, 'dimensions');
  assertCollectionLimit(query.measures, limits.maxMeasures, 'measures');
  assertCollectionLimit(query.filters, limits.maxFilters, 'filters');
  assertCollectionLimit(query.orderBy, limits.maxOrderBy, 'orderBy');

  const limit = query.limit ?? limits.defaultResultSize;
  if (limit > limits.maxResultSize) {
    throw new Error(`Invalid limit: ${limit}. Max: ${limits.maxResultSize}`);
  }
  if (query.offset !== undefined && query.offset > limits.maxOffset) {
    throw new Error(`Invalid offset: ${query.offset}. Max: ${limits.maxOffset}`);
  }
  return Object.freeze({ limit, ...(query.offset === undefined ? {} : { offset: query.offset }) });
}
