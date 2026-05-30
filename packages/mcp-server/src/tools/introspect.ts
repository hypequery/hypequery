/**
 * Get Dataset Schema Tool
 *
 * Returns the complete schema for a dataset including dimensions, metrics,
 * and relationships.
 */

export async function getDatasetSchemaTool(
  datasets: Record<string, any>,
  args: any
) {
  const datasetName = args.dataset;

  if (!datasetName) {
    throw new Error('dataset parameter is required');
  }

  const dataset = datasets[datasetName];

  if (!dataset) {
    throw new Error(`Dataset not found: ${datasetName}`);
  }

  // Build schema response
  const schema = {
    name: datasetName,
    description: dataset.description || dataset.config?.description || '',
    source: dataset.source || dataset.config?.source || '',
    timeKey: dataset.timeKey || dataset.config?.timeKey || null,
    tenantKey: dataset.tenantKey || dataset.config?.tenantKey || null,
    dimensions: {} as Record<string, any>,
    metrics: {} as Record<string, any>,
    relationships: {} as Record<string, any>,
  };

  // Extract dimensions
  if (dataset.dimensions) {
    for (const [name, dimension] of Object.entries(dataset.dimensions)) {
      const dim = dimension as any;
      schema.dimensions[name] = {
        type: dim.type || 'unknown',
        column: dim.column || name,
        label: dim.label || name,
        description: dim.description || '',
        examples: dim.examples || [],
      };
    }
  }

  // Extract metrics
  if (dataset.metrics) {
    for (const [name, metric] of Object.entries(dataset.metrics)) {
      const met = metric as any;
      schema.metrics[name] = {
        type: met.type || 'unknown',
        aggregation: met.aggregation || met.type || '',
        label: met.label || name,
        description: met.description || '',
        format: met.format || null,
      };
    }
  }

  // Extract relationships (if any)
  if (dataset.relationships) {
    for (const [name, relationship] of Object.entries(dataset.relationships)) {
      const rel = relationship as any;
      schema.relationships[name] = {
        type: rel.type || 'unknown',
        target: rel.target || rel.dataset?.name || '',
        description: rel.description || '',
      };
    }
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(schema, null, 2),
      },
    ],
  };
}
