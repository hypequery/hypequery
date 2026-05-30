/**
 * List Datasets Tool
 *
 * Returns a list of all available datasets with their descriptions.
 */

export async function listDatasetsTool(datasets: Record<string, any>) {
  const datasetList = Object.entries(datasets).map(([name, dataset]) => {
    // Try to extract description from dataset instance
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

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            datasets: datasetList,
            total: datasetList.length,
          },
          null,
          2
        ),
      },
    ],
  };
}
