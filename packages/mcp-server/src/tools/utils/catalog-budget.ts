import { MCPCatalogBudgetError } from '../../errors.js';
import {
  DEFAULT_MANIFEST_BYTES,
  DEFAULT_MANIFEST_TOOLS,
  MAX_MANIFEST_BYTES,
  MAX_MANIFEST_TOOLS,
  type MCPCatalogBudget,
} from '../../types.js';
import type { ListToolsResult } from '@modelcontextprotocol/sdk/types.js';

export interface EffectiveCatalogBudget {
  readonly maxTools: number;
  readonly maxManifestBytes: number;
}

function ceiling(
  value: number | undefined,
  fallback: number,
  maximum: number,
  name: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  }
  return resolved;
}

export function resolveCatalogBudget(
  configured: MCPCatalogBudget = {},
): EffectiveCatalogBudget {
  return Object.freeze({
    maxTools: ceiling(configured.maxTools, DEFAULT_MANIFEST_TOOLS, MAX_MANIFEST_TOOLS, 'maxTools'),
    maxManifestBytes: ceiling(
      configured.maxManifestBytes,
      DEFAULT_MANIFEST_BYTES,
      MAX_MANIFEST_BYTES,
      'maxManifestBytes',
    ),
  });
}

/**
 * Refuses a manifest too large to advertise, and says which ceiling it hit.
 *
 * Both counts are reported so a caller choosing a tool mode can tell a catalog
 * with too many targets from one with a few enormous ones; the answers are
 * different — fewer tools versus fewer enum members per tool.
 */
export function assertManifestWithinBudget(
  manifest: ListToolsResult,
  budget: EffectiveCatalogBudget,
): ListToolsResult {
  if (manifest.tools.length > budget.maxTools) {
    throw new MCPCatalogBudgetError(
      `The tool manifest advertises ${manifest.tools.length} tools; maximum is ${budget.maxTools}`,
    );
  }
  const size = Buffer.byteLength(JSON.stringify(manifest), 'utf8');
  if (size > budget.maxManifestBytes) {
    throw new MCPCatalogBudgetError(
      `The tool manifest is ${size} bytes across ${manifest.tools.length} tools; `
      + `maximum is ${budget.maxManifestBytes} bytes`,
    );
  }
  return manifest;
}
