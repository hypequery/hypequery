/**
 * List Datasets Tool
 *
 * Returns a list of all available datasets with their descriptions.
 */

import type { DatasetCatalogSource } from '@hypequery/datasets';
import type { DatasetRegistry, MCPToolResponse, DatasetsListResponse, DatasetListItem } from '../types.js';
import { agentDatasetCounts } from './utils/dataset-counts.js';
import { createMCPToolResponse } from './utils/tool-response.js';
import { listDatasetsBusinessContext, type MCPBusinessContext } from '../utils/business-context.js';

function isDatasetInstance(value: unknown): value is DatasetCatalogSource {
  return !!value && typeof value === 'object' && (value as { __type?: unknown }).__type === 'dataset';
}

export async function listDatasetsTool(
  datasets: DatasetRegistry,
  businessContext?: MCPBusinessContext,
): Promise<MCPToolResponse> {
  const datasetList: DatasetListItem[] = Object.entries(datasets).map(([name, dataset]) => {
    const datasetAny = dataset as any;
    // Try to extract description from dataset instance
    const description = datasetAny.description || datasetAny.config?.description || 'No description available';

    if (isDatasetInstance(dataset)) {
      return { name, description, ...agentDatasetCounts(name, dataset) };
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
    ...(businessContext === undefined ? {} : { businessContext: listDatasetsBusinessContext(businessContext) }),
  };

  return createMCPToolResponse(response);
}
