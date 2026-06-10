/**
 * Shared helpers for the MCP tools.
 */

import type { DatasetRegistry, RawDataset, MCPToolResponse } from '../types.js';

/**
 * Look up a dataset by name, throwing the standard validation errors when the
 * name is missing or unknown. Centralizes the lookup that every tool needs.
 */
export function resolveDataset(
  datasets: DatasetRegistry,
  datasetName: string | undefined,
): RawDataset {
  if (!datasetName) {
    throw new Error('dataset parameter is required');
  }

  const dataset = datasets[datasetName];

  if (!dataset) {
    throw new Error(`Dataset not found: ${datasetName}`);
  }

  return dataset;
}

/**
 * Wrap a JSON-serializable payload in the MCP text-content response shape.
 */
export function textResponse(payload: unknown): MCPToolResponse {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}
