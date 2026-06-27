/**
 * List Datasets Tool
 *
 * Returns a list of all available datasets with their descriptions.
 */

import type { DatasetRegistry, MCPToolResponse, DatasetsListResponse, DatasetListItem } from '../types.js';

export async function listDatasetsTool(datasets: DatasetRegistry): Promise<MCPToolResponse> {
  const datasetList: DatasetListItem[] = Object.entries(datasets).map(([name, dataset]) => {
    const datasetAny = dataset as any;
    // Try to extract description from dataset instance
    const description = datasetAny.description || datasetAny.config?.description || 'No description available';
    const dimensionCount = datasetAny.dimensions ? Object.keys(datasetAny.dimensions).length : 0;
    const measureCount = datasetAny.measures ? Object.keys(datasetAny.measures).length : 0;
    const metricCount = datasetAny.metrics ? Object.keys(datasetAny.metrics).length : measureCount;

    return {
      name,
      description,
      dimensionCount,
      measureCount,
      metricCount,
    };
  });

  const response: DatasetsListResponse = {
    datasets: datasetList,
    total: datasetList.length,
  };

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(response, null, 2),
      },
    ],
  };
}
