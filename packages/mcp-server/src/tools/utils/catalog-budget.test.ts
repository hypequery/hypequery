import type { ListToolsResult } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import { classifyMCPToolError, MCPCatalogBudgetError } from '../../errors.js';
import { assertManifestWithinBudget, resolveCatalogBudget } from './catalog-budget.js';

function manifest(tools: number, descriptionBytes = 0): ListToolsResult {
  return {
    tools: Array.from({ length: tools }, (_, index) => ({
      name: `tool_${index}`,
      description: 'x'.repeat(descriptionBytes),
      inputSchema: { type: 'object' as const, properties: {} },
    })),
  };
}

describe('catalog budgets', () => {
  it('resolves bounded defaults and rejects unsafe configuration', () => {
    expect(resolveCatalogBudget()).toEqual({
      maxTools: 64,
      maxManifestBytes: 262_144,
    });
    expect(() => resolveCatalogBudget({ maxTools: 0 }))
      .toThrow('maxTools must be an integer between 1 and 256');
    expect(() => resolveCatalogBudget({ maxTools: 257 }))
      .toThrow('maxTools must be an integer between 1 and 256');
    expect(() => resolveCatalogBudget({ maxManifestBytes: 1_048_577 }))
      .toThrow('maxManifestBytes must be an integer between 1 and 1048576');
    expect(() => resolveCatalogBudget({ maxManifestBytes: 1.5 }))
      .toThrow('maxManifestBytes must be an integer between 1 and 1048576');
  });

  it('returns a manifest inside both ceilings unchanged', () => {
    const within = manifest(4, 100);
    expect(assertManifestWithinBudget(within, resolveCatalogBudget())).toBe(within);
  });

  it('refuses a manifest advertising too many tools', () => {
    expect(() => assertManifestWithinBudget(manifest(9), resolveCatalogBudget({ maxTools: 8 })))
      .toThrow('The tool manifest advertises 9 tools; maximum is 8');
  });

  // The count is the cheaper check, but a catalog is far likelier to breach on
  // size: two query tools carrying an enum of every published field grow with
  // the deployment while the tool count stays at four.
  it('refuses a manifest too large in bytes even when the count is fine', () => {
    const budget = resolveCatalogBudget({ maxManifestBytes: 1_000 });
    expect(() => assertManifestWithinBudget(manifest(2, 800), budget))
      .toThrow(/^The tool manifest is \d+ bytes across 2 tools; maximum is 1000 bytes$/);
  });

  it('classifies the refusal as a budget failure that retrying cannot fix', () => {
    const error = new MCPCatalogBudgetError('too large');
    expect(classifyMCPToolError(error)).toMatchObject({
      code: 'MCP_CATALOG_TOO_LARGE',
      category: 'budget',
      retryable: false,
      correctable: false,
    });
  });
});
