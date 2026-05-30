/**
 * Query Dataset Tool
 *
 * Executes an ad-hoc dataset query with custom dimensions and metrics.
 */

import type { MetricExecutor } from '@hypequery/datasets';

export async function queryDatasetTool(
  datasets: Record<string, any>,
  executor: MetricExecutor,
  args: any
) {
  const { dataset: datasetName, dimensions, metrics, filters, grain, orderBy, limit } = args;

  if (!datasetName) {
    throw new Error('dataset parameter is required');
  }

  const dataset = datasets[datasetName];

  if (!dataset) {
    throw new Error(`Dataset not found: ${datasetName}`);
  }

  if (!dimensions?.length && !metrics?.length) {
    throw new Error('At least one dimension or metric must be specified');
  }

  // Build the query
  const query: any = {
    dimensions: dimensions || [],
    metrics: metrics || [],
    filters: filters || [],
    orderBy: orderBy || [],
  };

  if (grain) {
    query.by = grain;
  }

  if (limit) {
    query.limit = limit;
  }

  // For ad-hoc dataset queries, we need to use the dataset executor
  // This is a simplified implementation - you may need to adjust based on your actual dataset API
  const result = await executor.run(dataset, query, {
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
