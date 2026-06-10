/**
 * List Datasets Tool
 *
 * Returns a list of all available datasets with their descriptions.
 */

import type { DatasetRegistry, MCPToolResponse, DatasetsListResponse, DatasetListItem } from '../types.js';
import { textResponse } from './dataset-access.js';

export async function listDatasetsTool(datasets: DatasetRegistry): Promise<MCPToolResponse> {
  const datasetList: DatasetListItem[] = Object.entries(datasets).map(([name, dataset]) => {
    const description = dataset.description || dataset.config?.description || 'No description available';
    const dimensionCount = dataset.dimensions ? Object.keys(dataset.dimensions).length : 0;
    const metricCount = dataset.metrics ? Object.keys(dataset.metrics).length : 0;

    return {
      name,
      description,
      dimensionCount,
      metricCount,
    };
  });

  const response: DatasetsListResponse = {
    datasets: datasetList,
    total: datasetList.length,
  };

  return textResponse(response);
}
