import type { DatasetRegistry, MCPQueryLimits } from '../../types.js';
import { resolveQueryLimits } from './query-limits.js';

export type JsonObject = Record<string, unknown>;

/**
 * Builds a dataset-discriminated query schema that advertises each dataset's
 * effective server and semantic-layer limits to MCP clients.
 */
export function advertiseDatasetQueryLimits(
  schema: JsonObject,
  datasets: DatasetRegistry,
  configured: MCPQueryLimits | undefined,
  includeMeasures: boolean,
): JsonObject {
  const entries = Object.entries(datasets);
  if (entries.length === 0) return schema;
  const properties = schema.properties as Record<string, JsonObject>;

  return {
    type: 'object',
    anyOf: entries.map(([name, dataset]) => {
      const limits = resolveQueryLimits(dataset, configured);
      return {
        ...schema,
        properties: {
          ...properties,
          dataset: { ...properties.dataset, enum: [name] },
          dimensions: { ...properties.dimensions, maxItems: limits.maxDimensions },
          ...(includeMeasures ? {
            measures: { ...properties.measures, maxItems: limits.maxMeasures },
          } : {}),
          filters: { ...properties.filters, maxItems: limits.maxFilters },
          orderBy: { ...properties.orderBy, maxItems: limits.maxOrderBy },
          limit: {
            ...properties.limit,
            maximum: limits.maxResultSize,
            default: limits.defaultResultSize,
          },
          offset: { ...properties.offset, maximum: limits.maxOffset },
        },
      };
    }),
  };
}
