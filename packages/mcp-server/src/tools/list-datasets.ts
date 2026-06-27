/**
 * List Datasets Tool
 *
 * Returns a list of all available datasets with their descriptions.
 */

import { getDatasetCatalog } from '@hypequery/datasets';
import type { DatasetRegistry, MCPToolResponse, DatasetsListResponse, DatasetListItem } from '../types.js';

function isDatasetInstance(value: unknown): value is Parameters<typeof getDatasetCatalog>[0] {
  return !!value && typeof value === 'object' && (value as { __type?: unknown }).__type === 'dataset';
}

export async function listDatasetsTool(datasets: DatasetRegistry): Promise<MCPToolResponse> {
  const datasetList: DatasetListItem[] = Object.entries(datasets).map(([name, dataset]) => {
    const datasetAny = dataset as any;
    // Try to extract description from dataset instance
    const description = datasetAny.description || datasetAny.config?.description || 'No description available';

    if (isDatasetInstance(dataset)) {
      const catalog = getDatasetCatalog(dataset);
      return {
        name,
        description,
        dimensionCount: Object.keys(catalog.dimensions).length,
        measureCount: Object.keys(catalog.measures).length,
        metricCount: Object.keys(catalog.metrics).length,
      };
    }

    const dimensionCount = datasetAny.dimensions ? Object.keys(datasetAny.dimensions).length : 0;
    const measureCount = datasetAny.measures ? Object.keys(datasetAny.measures).length : 0;
    const metricCount = datasetAny.metrics ? Object.keys(datasetAny.metrics).length : 0;

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
