import { getDatasetCatalog, type AgentCatalogDatasetRegistry, type DatasetCatalogSource } from '@hypequery/datasets';
import type { DatasetsConfig } from '../../../types.js';
import { resolveDatasetEntry } from './dataset-entry.js';

/** Remap presentation names without changing executable dataset definitions. */
export function buildDiscoveryCatalogSource(
  source: Record<string, DatasetCatalogSource>,
  registrations: DatasetsConfig<any>,
): AgentCatalogDatasetRegistry {
  const aliases = new Map<object, string>();
  for (const [name, entry] of Object.entries(registrations)) {
    const dataset = resolveDatasetEntry(entry).dataset;
    // Multiple registrations of one definition all address the same target.
    if (!aliases.has(dataset)) aliases.set(dataset, name);
  }
  return Object.fromEntries(Object.entries(source).map(([name, dataset]) => {
    const catalog = getDatasetCatalog(dataset);
    return [name, {
      ...catalog,
      relationships: Object.fromEntries(Object.entries(catalog.relationships).map(([key, relationship]) => [key, {
        ...relationship,
        target: aliases.get(dataset.relationships[key].target()) ?? relationship.target,
      }])),
    }];
  }));
}
