import type { SemanticContract } from '@hypequery/datasets';

/** Only logical vocabulary is published. New definition fields fail closed here. */
function logicalFields(value: object, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([key, entry]) => keys.includes(key) && entry !== undefined),
  );
}

function logicalEntries(
  entries: Record<string, object>,
  keys: readonly string[],
): Record<string, object> {
  return Object.fromEntries(
    Object.entries(entries).map(([name, entry]) => [name, logicalFields(entry, keys)]),
  );
}

export function publicSemanticContract(contract: SemanticContract): {
  version: number;
  contentHash: string;
  datasets: Record<string, object>;
} {
  return {
    version: contract.version,
    // Retain the opaque definition identity used by existing interop consumers.
    contentHash: contract.contentHash,
    datasets: Object.fromEntries(Object.entries(contract.datasets).map(([name, dataset]) => [name, {
      ...logicalFields(dataset, ['name', 'label', 'description', 'supportedGrains']),
      dimensions: logicalEntries(dataset.dimensions, [
        'type', 'label', 'description', 'filterable', 'groupable',
      ]),
      measures: logicalEntries(dataset.measures, [
        'aggregation', 'level', 'label', 'description', 'approximate',
        'kind', 'measure', 'interval', 'trailing', 'toDate', 'cumulative',
        'requiresTimeRange', 'supportedGrains',
      ]),
      metrics: logicalEntries(dataset.metrics, [
        'kind', 'valueType', 'label', 'description', 'dimensions', 'measures',
        'filters', 'grains', 'grain',
      ]),
      filters: logicalEntries(dataset.filters, ['label', 'description', 'operators', 'valueType']),
      relationships: logicalEntries(dataset.relationships, ['kind', 'target', 'queryable', 'fields']),
      ...(dataset.segments ? {
        segments: logicalEntries(dataset.segments, ['label', 'description']),
      } : {}),
      ...(dataset.limits ? {
        limits: logicalFields(dataset.limits, [
          'maxDimensions', 'maxMeasures', 'maxFilters', 'maxResultSize',
        ]),
      } : {}),
    }])),
  };
}
