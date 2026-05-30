/**
 * Query Metric Tool
 *
 * Executes a metric query with optional dimensions, filters, grain, and sorting.
 */

import type { MetricExecutor } from '@hypequery/datasets';

export async function queryMetricTool(
  datasets: Record<string, any>,
  executor: MetricExecutor,
  args: any
) {
  const { dataset: datasetName, metric: metricName, dimensions, filters, grain, orderBy, limit } = args;

  if (!datasetName) {
    throw new Error('dataset parameter is required');
  }

  if (!metricName) {
    throw new Error('metric parameter is required');
  }

  const dataset = datasets[datasetName];

  if (!dataset) {
    throw new Error(`Dataset not found: ${datasetName}`);
  }

  // Get the metric from the dataset
  const metric = dataset[metricName] || dataset.metrics?.[metricName];

  if (!metric) {
    throw new Error(`Metric not found: ${metricName} in dataset ${datasetName}`);
  }

  // Build the query
  const query: any = {
    dimensions: dimensions || [],
    filters: filters || [],
    orderBy: orderBy || [],
  };

  if (grain) {
    query.by = grain;
  }

  if (limit) {
    query.limit = limit;
  }

  // Execute the query
  const result = await executor.run(metric, query, {
    runtime: {
      builderFactory: executor.getBuilderFactory(),
      tenant: undefined,
    },
  });

  // Format the response
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            data: result.data,
            meta: {
              sql: result.meta?.sql,
              timingMs: result.meta?.timingMs,
              rowCount: result.data.length,
            },
          },
          null,
          2
        ),
      },
    ],
  };
}
