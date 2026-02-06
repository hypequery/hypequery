/**
 * Dataset Introspection API
 *
 * Provides introspection capabilities for datasets, enabling AI agents
 * and other tools to understand the structure and metadata of datasets.
 *
 * Key functions:
 * - getDatasetSchema(): Get full schema for a dataset
 * - listDatasets(): List all available datasets
 * - introspectDimension(): Get metadata for a specific dimension
 * - introspectMetric(): Get metadata for a specific metric
 */

import type {
  DatasetDefinition,
  DatasetsMap,
  IntrospectedDataset,
  IntrospectedDimension,
  IntrospectedMetric,
} from './types.js';
import {
  getDataset,
  listDatasets as listDatasetNames,
  normalizeDimension,
  getDimensionSQL,
  getMetricSQL,
} from './definition.js';

// =============================================================================
// DIMENSION INTROSPECTION
// =============================================================================

/**
 * Introspect a dimension definition to extract metadata
 *
 * @param dimension - Dimension definition (any format)
 * @returns Introspected dimension metadata
 */
export function introspectDimension(
  dimension: DatasetDefinition['dimensions'][string]
): IntrospectedDimension {
  const normalized = normalizeDimension(dimension);

  return {
    type: normalized.type,
    description: normalized.description || undefined,
    examples: normalized.examples,
    sql: getDimensionSQL(dimension),
  };
}

// =============================================================================
// METRIC INTROSPECTION
// =============================================================================

/**
 * Introspect a metric definition to extract metadata
 *
 * @param metric - Metric definition
 * @returns Introspected metric metadata
 */
export function introspectMetric(
  metric: DatasetDefinition['metrics'][string]
): IntrospectedMetric {
  return {
    type: 'number',
    aggregationType: metric.type,
    description: metric.description,
    format: metric.format,
    sql: getMetricSQL(metric),
  };
}

// =============================================================================
// DATASET INTROSPECTION
// =============================================================================

/**
 * Get the complete schema for a dataset (for AI agents)
 *
 * @param datasets - Map of all dataset definitions
 * @param datasetName - Name of the dataset to introspect
 * @returns Introspected dataset schema
 * @throws Error if dataset not found
 *
 * @example
 * ```typescript
 * const schema = getDatasetSchema(datasets, 'orders');
 * console.log(schema.dimensions.region.description);
 * console.log(schema.metrics.revenue.format);
 * ```
 */
export function getDatasetSchema(
  datasets: DatasetsMap,
  datasetName: string
): IntrospectedDataset {
  const dataset = getDataset(datasets, datasetName);

  // Introspect all dimensions
  const dimensions: Record<string, IntrospectedDimension> = {};
  for (const [name, dimension] of Object.entries(dataset.dimensions)) {
    dimensions[name] = introspectDimension(dimension);
  }

  // Introspect all metrics
  const metrics: Record<string, IntrospectedMetric> = {};
  for (const [name, metric] of Object.entries(dataset.metrics)) {
    metrics[name] = introspectMetric(metric);
  }

  return {
    name: dataset.name,
    description: dataset.description,
    table: dataset.table,
    dimensions,
    metrics,
    tenantRequired: dataset.tenant?.required,
    limits: dataset.limits,
  };
}

/**
 * List all available datasets
 *
 * @param datasets - Map of all dataset definitions
 * @returns Array of dataset names
 *
 * @example
 * ```typescript
 * const allDatasets = listDatasets(datasets);
 * // ['orders', 'customers', 'products']
 * ```
 */
export function listDatasets(datasets: DatasetsMap): string[] {
  return listDatasetNames(datasets);
}

/**
 * Get introspected schemas for all datasets
 *
 * @param datasets - Map of all dataset definitions
 * @returns Map of dataset names to introspected schemas
 *
 * @example
 * ```typescript
 * const allSchemas = getAllDatasetSchemas(datasets);
 * for (const [name, schema] of Object.entries(allSchemas)) {
 *   console.log(`Dataset: ${name}`);
 *   console.log(`Description: ${schema.description}`);
 * }
 * ```
 */
export function getAllDatasetSchemas(
  datasets: DatasetsMap
): Record<string, IntrospectedDataset> {
  const schemas: Record<string, IntrospectedDataset> = {};

  for (const name of listDatasetNames(datasets)) {
    schemas[name] = getDatasetSchema(datasets, name);
  }

  return schemas;
}

/**
 * Generate a human-readable summary of a dataset (for LLMs)
 *
 * @param datasets - Map of all dataset definitions
 * @param datasetName - Name of the dataset to summarize
 * @returns Markdown-formatted summary
 *
 * @example
 * ```typescript
 * const summary = summarizeDataset(datasets, 'orders');
 * console.log(summary);
 * // # Dataset: orders
 * // Customer orders and revenue data
 * //
 * // ## Dimensions
 * // - region (string): Geographic region
 * //   Examples: US, EU, APAC
 * // ...
 * ```
 */
export function summarizeDataset(
  datasets: DatasetsMap,
  datasetName: string
): string {
  const schema = getDatasetSchema(datasets, datasetName);
  const lines: string[] = [];

  // Header
  lines.push(`# Dataset: ${schema.name}`);
  lines.push(schema.description);
  lines.push('');

  // Dimensions
  lines.push('## Dimensions');
  for (const [name, dimension] of Object.entries(schema.dimensions) as [string, IntrospectedDimension][]) {
    lines.push(
      `- ${name} (${dimension.type})${
        dimension.description ? `: ${dimension.description}` : ''
      }`
    );
    if (dimension.examples && dimension.examples.length > 0) {
      lines.push(`  Examples: ${dimension.examples.join(', ')}`);
    }
  }
  lines.push('');

  // Metrics
  lines.push('## Metrics');
  for (const [name, metric] of Object.entries(schema.metrics) as [string, IntrospectedMetric][]) {
    lines.push(
      `- ${name} (${metric.aggregationType})${
        metric.description ? `: ${metric.description}` : ''
      }`
    );
    if (metric.format) {
      lines.push(`  Format: ${metric.format}`);
    }
  }
  lines.push('');

  // Constraints
  if (schema.tenantRequired || schema.limits) {
    lines.push('## Constraints');
    if (schema.tenantRequired) {
      lines.push('- Multi-tenancy: Required');
    }
    if (schema.limits) {
      if (schema.limits.maxDimensions) {
        lines.push(`- Max dimensions: ${schema.limits.maxDimensions}`);
      }
      if (schema.limits.maxMetrics) {
        lines.push(`- Max metrics: ${schema.limits.maxMetrics}`);
      }
      if (schema.limits.maxFilters) {
        lines.push(`- Max filters: ${schema.limits.maxFilters}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Generate a JSON representation of all datasets (for AI context)
 *
 * @param datasets - Map of all dataset definitions
 * @returns JSON string with all dataset schemas
 *
 * @example
 * ```typescript
 * const json = datasetsToJSON(datasets);
 * // Send to LLM as context for query generation
 * ```
 */
export function datasetsToJSON(datasets: DatasetsMap): string {
  const schemas = getAllDatasetSchemas(datasets);
  return JSON.stringify(schemas, null, 2);
}

/**
 * Get a concise summary of all datasets (for LLM context)
 *
 * @param datasets - Map of all dataset definitions
 * @returns Array of dataset summaries
 *
 * @example
 * ```typescript
 * const summaries = summarizeAllDatasets(datasets);
 * // [
 * //   {
 * //     name: 'orders',
 * //     description: 'Customer orders and revenue data',
 * //     dimensionCount: 5,
 * //     metricCount: 4
 * //   },
 * //   ...
 * // ]
 * ```
 */
export function summarizeAllDatasets(
  datasets: DatasetsMap
): Array<{
  name: string;
  description: string;
  dimensionCount: number;
  metricCount: number;
}> {
  return listDatasetNames(datasets).map((name: string) => {
    const schema = getDatasetSchema(datasets, name);
    return {
      name: schema.name,
      description: schema.description,
      dimensionCount: Object.keys(schema.dimensions).length,
      metricCount: Object.keys(schema.metrics).length,
    };
  });
}
