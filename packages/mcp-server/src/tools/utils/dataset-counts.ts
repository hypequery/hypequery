import { getDatasetCatalog, projectAgentSafeCatalog, type DatasetCatalogSource } from '@hypequery/datasets';

export interface DatasetCounts {
  dimensionCount: number;
  measureCount: number;
  metricCount: number;
}

/**
 * What `get_dataset_schema` shows for a dataset, counted, so `list_datasets`
 * and the schema tool never disagree: derived measures count as measures,
 * and only fields an agent can select count at all. A dataset whose
 * projection is over the catalog byte budget falls back to its catalog.
 */
export function agentDatasetCounts(name: string, dataset: DatasetCatalogSource): DatasetCounts {
  try {
    const projected = projectAgentSafeCatalog({ [name]: dataset }).datasets[0];
    return {
      dimensionCount: projected.dimensions.length,
      measureCount: projected.measures.length,
      metricCount: projected.metrics.length,
    };
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    const catalog = getDatasetCatalog(dataset);
    return {
      dimensionCount: Object.keys(catalog.dimensions).length,
      measureCount: Object.keys(catalog.measures).length + Object.keys(catalog.derivedMeasures ?? {}).length,
      metricCount: Object.keys(catalog.metrics).length,
    };
  }
}
