import type { AnyDatasetInstance } from '../types.js';

export function collectCloudDatasets(
  datasets: Map<string, AnyDatasetInstance>,
  dataset: AnyDatasetInstance,
): void {
  const existing = datasets.get(dataset.name);
  if (existing && existing !== dataset) {
    throw new Error(`Multiple Dataset definitions use the name "${dataset.name}".`);
  }
  if (existing) return;
  datasets.set(dataset.name, dataset);
  for (const relationship of Object.values(dataset.relationships)) {
    collectCloudDatasets(datasets, relationship.target() as AnyDatasetInstance);
  }
}
