/**
 * Serve integration for the semantic contract: assembles the contract source
 * from registered datasets/metrics and exposes it as a cached GET endpoint.
 *
 * The contract is a stable, hashed JSON projection of the semantic layer
 * (dimensions, measures, metrics, filters, relationships, tenant/time policy).
 * It is the shared source consumed by snapshots, CI validation, docs, and
 * codegen. The serialized document is cached after the first request since the
 * registered datasets do not change at runtime.
 */

import { z } from 'zod';
import type { DatasetCatalogSource, SemanticContract } from '@hypequery/datasets';
import type { AuthContext, DatasetsConfig, MetricsConfig, ServeEndpoint } from '../../types.js';
import { resolveDatasetEntry } from './utils/dataset-entry.js';
import { resolveMetricEntry } from './metric-endpoint.js';

/**
 * Builds the `serializeSemanticContract` input from the registered datasets and
 * metrics, grouping each named metric onto its dataset by dataset name.
 */
export function buildSemanticContractSource(
  datasets: DatasetsConfig<any>,
  metrics?: MetricsConfig<any>,
): Record<string, DatasetCatalogSource> {
  const metricsByDatasetName: Record<string, Record<string, unknown>> = {};
  for (const [metricName, entry] of Object.entries(metrics ?? {})) {
    const metric = resolveMetricEntry(entry).metric;
    const datasetName = metric.contract().dataset;
    (metricsByDatasetName[datasetName] ??= {})[metricName] = metric;
  }

  const source: Record<string, DatasetCatalogSource> = {};
  for (const [name, entry] of Object.entries(datasets)) {
    const ds = resolveDatasetEntry(entry).dataset;
    source[name] = { ...ds, metrics: metricsByDatasetName[ds.name] } as DatasetCatalogSource;
  }
  return source;
}

export function createSemanticContractEndpoint(
  path: string,
  getContract: () => SemanticContract,
): ServeEndpoint<any, any, Record<string, unknown>, AuthContext> {
  let cached: SemanticContract | null = null;
  return {
    key: '__hypequery_semantic_contract__',
    method: 'GET',
    inputSchema: undefined,
    outputSchema: z.any(),
    handler: async () => {
      if (!cached) {
        cached = getContract();
      }
      return cached;
    },
    query: undefined,
    middlewares: [],
    auth: null,
    metadata: {
      path,
      method: 'GET',
      name: 'Semantic contract',
      summary: 'Semantic contract',
      description:
        'Stable, hashed JSON contract for the registered semantic datasets and metrics. ' +
        'Use it for snapshots, CI validation, docs, and codegen.',
      tags: ['datasets'],
      requiresAuth: false,
      deprecated: false,
      visibility: 'public',
    },
    cacheTtlMs: null,
  } satisfies ServeEndpoint<any, any, Record<string, unknown>, AuthContext>;
}
