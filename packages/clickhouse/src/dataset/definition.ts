/**
 * Dataset Definition Utilities
 *
 * Provides utilities for creating and managing dataset definitions:
 * - Dataset validation
 * - Dimension/metric normalization
 * - Type inference helpers
 */

import type {
  DatasetDefinition,
  DatasetsMap,
  DimensionsMap,
  MetricsMap,
  Dimension,
  DimensionDefinition,
  DimensionType,
} from './types.js';
import { isSQLExpression, toSQLString, type SQLExpression } from './sql-tag.js';
import {
  validateDimensionDefinition,
  validateMetricDefinition,
} from './helpers.js';

// =============================================================================
// DATASET VALIDATION
// =============================================================================

/**
 * Validate a complete dataset definition
 *
 * @param name - Dataset name
 * @param definition - Dataset definition
 * @throws Error if validation fails
 */
export function validateDatasetDefinition(
  name: string,
  definition: DatasetDefinition
): void {
  // Validate required fields
  if (!definition.name) {
    throw new Error(`Dataset '${name}' is missing 'name' property.`);
  }

  if (!definition.description) {
    console.warn(
      `⚠️  Dataset '${name}' is missing 'description'. ` +
      `Descriptions help AI agents understand your data.`
    );
  }

  if (!definition.table) {
    throw new Error(`Dataset '${name}' is missing 'table' property.`);
  }

  // Validate dimensions
  if (!definition.dimensions || Object.keys(definition.dimensions).length === 0) {
    throw new Error(
      `Dataset '${name}' must have at least one dimension. ` +
      `Dimensions define the grouping keys for your data.`
    );
  }

  for (const [dimName, dimDef] of Object.entries(definition.dimensions)) {
    validateDimensionDefinition(dimName, dimDef);
  }

  // Validate metrics
  if (!definition.metrics || Object.keys(definition.metrics).length === 0) {
    throw new Error(
      `Dataset '${name}' must have at least one metric. ` +
      `Metrics define the aggregations for your data.`
    );
  }

  for (const [metricName, metricDef] of Object.entries(definition.metrics)) {
    validateMetricDefinition(metricName, metricDef);
  }

  // Validate tenant config
  if (definition.tenant) {
    if (!definition.tenant.column) {
      throw new Error(
        `Dataset '${name}' tenant config is missing 'column' property.`
      );
    }
  }

  // Validate limits
  if (definition.limits) {
    const limits = definition.limits;

    if (limits.maxDimensions !== undefined && limits.maxDimensions < 1) {
      throw new Error(
        `Dataset '${name}' limits.maxDimensions must be at least 1.`
      );
    }

    if (limits.maxMetrics !== undefined && limits.maxMetrics < 1) {
      throw new Error(
        `Dataset '${name}' limits.maxMetrics must be at least 1.`
      );
    }

    if (limits.maxFilters !== undefined && limits.maxFilters < 0) {
      throw new Error(
        `Dataset '${name}' limits.maxFilters must be non-negative.`
      );
    }

    if (limits.maxResultSize !== undefined && limits.maxResultSize < 1) {
      throw new Error(
        `Dataset '${name}' limits.maxResultSize must be at least 1.`
      );
    }
  }
}

/**
 * Validate all datasets in a datasets map
 *
 * @param datasets - Map of dataset definitions
 * @throws Error if any dataset is invalid
 */
export function validateDatasets(datasets: DatasetsMap): void {
  if (!datasets || Object.keys(datasets).length === 0) {
    throw new Error(
      'No datasets defined. Please define at least one dataset.'
    );
  }

  for (const [name, definition] of Object.entries(datasets)) {
    validateDatasetDefinition(name, definition);
  }
}

// =============================================================================
// DIMENSION NORMALIZATION
// =============================================================================

/**
 * Normalize a dimension definition to full DimensionDefinition object
 *
 * @param dimension - Dimension definition (simple or complex)
 * @returns Normalized DimensionDefinition
 */
export function normalizeDimension(dimension: Dimension): DimensionDefinition {
  // Simple string column reference
  if (typeof dimension === 'string') {
    return {
      sql: dimension,
      type: 'string', // Default type for simple columns
      description: '', // Empty description (should be filled by user)
    };
  }

  // SQLExpression
  if (isSQLExpression(dimension)) {
    return {
      sql: dimension,
      type: 'string', // Default type for SQL expressions
      description: '', // Empty description (should be filled by user)
    };
  }

  // Already a full DimensionDefinition
  return dimension;
}

/**
 * Normalize all dimensions in a dimensions map
 *
 * @param dimensions - Map of dimension definitions
 * @returns Map of normalized dimension definitions
 */
export function normalizeDimensions(
  dimensions: DimensionsMap
): Record<string, DimensionDefinition> {
  const normalized: Record<string, DimensionDefinition> = {};

  for (const [name, dimension] of Object.entries(dimensions)) {
    normalized[name] = normalizeDimension(dimension);
  }

  return normalized;
}

// =============================================================================
// TYPE INFERENCE HELPERS
// =============================================================================

/**
 * Infer the TypeScript type from a dimension definition
 *
 * @param dimension - Dimension definition
 * @returns Inferred type name
 */
export function inferDimensionType(dimension: Dimension): DimensionType {
  const normalized = normalizeDimension(dimension);
  return normalized.type;
}

/**
 * Get the SQL string from a dimension definition
 *
 * @param dimension - Dimension definition
 * @returns SQL string
 */
export function getDimensionSQL(dimension: Dimension): string {
  const normalized = normalizeDimension(dimension);
  return toSQLString(normalized.sql);
}

/**
 * Get the SQL string from a metric definition
 *
 * @param metric - Metric definition
 * @returns SQL string
 */
export function getMetricSQL(metric: {
  sql: string | SQLExpression;
}): string {
  return toSQLString(metric.sql);
}

// =============================================================================
// DATASET UTILITIES
// =============================================================================

/**
 * Get a dataset definition by name
 *
 * @param datasets - Map of dataset definitions
 * @param name - Dataset name
 * @returns Dataset definition
 * @throws Error if dataset not found
 */
export function getDataset(
  datasets: DatasetsMap,
  name: string
): DatasetDefinition {
  const dataset = datasets[name];

  if (!dataset) {
    throw new Error(
      `Dataset '${name}' not found. ` +
      `Available datasets: ${Object.keys(datasets).join(', ')}`
    );
  }

  return dataset;
}

/**
 * List all dataset names
 *
 * @param datasets - Map of dataset definitions
 * @returns Array of dataset names
 */
export function listDatasets(datasets: DatasetsMap): string[] {
  return Object.keys(datasets);
}

/**
 * Check if a dataset exists
 *
 * @param datasets - Map of dataset definitions
 * @param name - Dataset name
 * @returns True if dataset exists
 */
export function hasDataset(datasets: DatasetsMap, name: string): boolean {
  return name in datasets;
}

/**
 * Get dimension names for a dataset
 *
 * @param dataset - Dataset definition
 * @returns Array of dimension names
 */
export function getDimensionNames(dataset: DatasetDefinition): string[] {
  return Object.keys(dataset.dimensions);
}

/**
 * Get metric names for a dataset
 *
 * @param dataset - Dataset definition
 * @returns Array of metric names
 */
export function getMetricNames(dataset: DatasetDefinition): string[] {
  return Object.keys(dataset.metrics);
}

/**
 * Check if a dimension exists in a dataset
 *
 * @param dataset - Dataset definition
 * @param dimensionName - Dimension name
 * @returns True if dimension exists
 */
export function hasDimension(
  dataset: DatasetDefinition,
  dimensionName: string
): boolean {
  return dimensionName in dataset.dimensions;
}

/**
 * Check if a metric exists in a dataset
 *
 * @param dataset - Dataset definition
 * @param metricName - Metric name
 * @returns True if metric exists
 */
export function hasMetric(
  dataset: DatasetDefinition,
  metricName: string
): boolean {
  return metricName in dataset.metrics;
}

/**
 * Get a dimension definition from a dataset
 *
 * @param dataset - Dataset definition
 * @param dimensionName - Dimension name
 * @returns Normalized dimension definition
 * @throws Error if dimension not found
 */
export function getDimension(
  dataset: DatasetDefinition,
  dimensionName: string
): DimensionDefinition {
  if (!hasDimension(dataset, dimensionName)) {
    throw new Error(
      `Dimension '${dimensionName}' not found in dataset '${dataset.name}'. ` +
      `Available dimensions: ${getDimensionNames(dataset).join(', ')}`
    );
  }

  return normalizeDimension(dataset.dimensions[dimensionName]);
}

/**
 * Get a metric definition from a dataset
 *
 * @param dataset - Dataset definition
 * @param metricName - Metric name
 * @returns Metric definition
 * @throws Error if metric not found
 */
export function getMetric(
  dataset: DatasetDefinition,
  metricName: string
) {
  if (!hasMetric(dataset, metricName)) {
    throw new Error(
      `Metric '${metricName}' not found in dataset '${dataset.name}'. ` +
      `Available metrics: ${getMetricNames(dataset).join(', ')}`
    );
  }

  return dataset.metrics[metricName];
}
