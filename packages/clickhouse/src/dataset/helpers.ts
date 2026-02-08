/**
 * Dataset Helper Functions
 *
 * Provides declarative helper functions for defining dimensions and metrics:
 * - dimension.string(), dimension.number(), dimension.date(), dimension.boolean()
 * - metric.count(), metric.sum(), metric.avg(), metric.min(), metric.max(), metric.countDistinct(), metric.custom()
 */

import type {
  DimensionDefinition,
  DimensionType,
  MetricDefinition,
  MetricAggregationType,
  MetricFormat,
} from './types.js';
import { sql, type SQLExpression } from './sql-tag.js';

// =============================================================================
// DIMENSION HELPERS
// =============================================================================

/**
 * Options for dimension helpers
 */
export interface DimensionOptions {
  /** Human-readable description (for AI agents) */
  description: string;
  /** Example values (for AI context) */
  examples?: string[];
  /** Join name (if dimension requires a join) */
  join?: string;
}

/**
 * Create a dimension definition helper
 */
function createDimensionHelper(type: DimensionType) {
  return (
    columnOrExpression: string | SQLExpression,
    options: DimensionOptions
  ): DimensionDefinition => {
    return {
      sql: columnOrExpression,
      type,
      description: options.description,
      examples: options.examples,
      join: options.join,
    };
  };
}

/**
 * Dimension helper namespace
 *
 * @example
 * ```typescript
 * dimensions: {
 *   region: dimension.string('region', {
 *     description: 'Geographic region',
 *     examples: ['US', 'EU', 'APAC']
 *   }),
 *   orderDate: dimension.date(sql`DATE(created_at)`, {
 *     description: 'Order date'
 *   }),
 *   amount: dimension.number('amount', {
 *     description: 'Order amount'
 *   })
 * }
 * ```
 */
export const dimension = {
  /**
   * Create a string dimension
   */
  string: createDimensionHelper('string'),

  /**
   * Create a number dimension
   */
  number: createDimensionHelper('number'),

  /**
   * Create a date dimension
   */
  date: createDimensionHelper('date'),

  /**
   * Create a boolean dimension
   */
  boolean: createDimensionHelper('boolean'),
};

// =============================================================================
// METRIC HELPERS
// =============================================================================

/**
 * Options for metric helpers
 */
export interface MetricOptions {
  /** Human-readable description (for AI agents) */
  description: string;
  /** Format hint for display */
  format?: MetricFormat;
  /** Join name (if metric requires a join) */
  join?: string;
  /** Allow fan-out (for oneToMany joins) - advanced use only */
  allowFanout?: boolean;
}

/**
 * Create a metric definition helper
 */
function createMetricHelper(type: MetricAggregationType) {
  return (
    columnOrExpression: string | SQLExpression,
    options: MetricOptions
  ): MetricDefinition => {
    return {
      type,
      sql: columnOrExpression,
      description: options.description,
      format: options.format,
      join: options.join,
      allowFanout: options.allowFanout,
    };
  };
}

/**
 * Metric helper namespace
 *
 * @example
 * ```typescript
 * metrics: {
 *   revenue: metric.sum('amount', {
 *     description: 'Total revenue',
 *     format: 'currency'
 *   }),
 *   orderCount: metric.count({
 *     description: 'Total number of orders'
 *   }),
 *   avgOrderValue: metric.avg('total_amount', {
 *     description: 'Average order value',
 *     format: 'currency'
 *   }),
 *   revenuePerCustomer: metric.custom(
 *     sql`sum(total_amount) / count(DISTINCT customer_id)`,
 *     {
 *       description: 'Average revenue per customer',
 *       format: 'currency'
 *     }
 *   )
 * }
 * ```
 */
export const metric = {
  /**
   * Create a COUNT(*) metric
   */
  count: (options: MetricOptions): MetricDefinition => {
    return {
      type: 'count',
      sql: sql`*`,
      description: options.description,
      format: options.format,
      join: options.join,
      allowFanout: options.allowFanout,
    };
  },

  /**
   * Create a SUM() metric
   */
  sum: createMetricHelper('sum'),

  /**
   * Create an AVG() metric
   */
  avg: createMetricHelper('avg'),

  /**
   * Create a MIN() metric
   */
  min: createMetricHelper('min'),

  /**
   * Create a MAX() metric
   */
  max: createMetricHelper('max'),

  /**
   * Create a COUNT(DISTINCT) metric
   */
  countDistinct: createMetricHelper('countDistinct'),

  /**
   * Create a custom metric with a SQL expression
   */
  custom: createMetricHelper('custom'),
};

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

/**
 * Validate that a dimension definition has required metadata
 */
export function validateDimensionDefinition(
  name: string,
  definition: unknown
): void {
  if (typeof definition === 'string') {
    // Simple column reference - no validation needed
    return;
  }

  if (typeof definition === 'object' && definition !== null) {
    const def = definition as Partial<DimensionDefinition>;

    if (!def.sql) {
      throw new Error(
        `Dimension '${name}' is missing 'sql' property. ` +
        `Expected a column name (string) or SQLExpression.`
      );
    }

    if (!def.type) {
      throw new Error(
        `Dimension '${name}' is missing 'type' property. ` +
        `Expected: 'string', 'number', 'date', or 'boolean'.`
      );
    }

    if (!def.description) {
      console.warn(
        `⚠️  Dimension '${name}' is missing 'description'. ` +
        `Descriptions help AI agents understand your data.`
      );
    }
  }
}

/**
 * Validate that a metric definition has required metadata
 */
export function validateMetricDefinition(
  name: string,
  definition: unknown
): void {
  if (typeof definition !== 'object' || definition === null) {
    throw new Error(
      `Metric '${name}' must be a MetricDefinition object. ` +
      `Use metric.sum(), metric.count(), etc. helpers.`
    );
  }

  const def = definition as Partial<MetricDefinition>;

  if (!def.type) {
    throw new Error(
      `Metric '${name}' is missing 'type' property. ` +
      `Expected: 'count', 'sum', 'avg', 'min', 'max', 'countDistinct', or 'custom'.`
    );
  }

  if (!def.sql) {
    throw new Error(
      `Metric '${name}' is missing 'sql' property. ` +
      `Expected a column name (string) or SQLExpression.`
    );
  }

  if (!def.description) {
    console.warn(
      `⚠️  Metric '${name}' is missing 'description'. ` +
      `Descriptions help AI agents understand your metrics.`
    );
  }
}
