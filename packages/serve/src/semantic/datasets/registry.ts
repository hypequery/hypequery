/**
 * DatasetRegistry — runtime registry of defined datasets.
 *
 * Used by MetricExecutor and serve() to discover datasets at startup.
 */

import type { DatasetInstance, DatasetRegistryInstance } from './types.js';

export function createDatasetRegistry(): DatasetRegistryInstance {
  const datasets = new Map<string, DatasetInstance<any>>();

  return {
    register(ds: DatasetInstance<any>): void {
      if (datasets.has(ds.name)) {
        throw new Error(
          `Dataset "${ds.name}" is already registered. Dataset names must be unique.`,
        );
      }
      datasets.set(ds.name, ds);
    },

    get(name: string): DatasetInstance<any> | undefined {
      return datasets.get(name);
    },

    getAll(): DatasetInstance<any>[] {
      return Array.from(datasets.values());
    },

    has(name: string): boolean {
      return datasets.has(name);
    },
  };
}
