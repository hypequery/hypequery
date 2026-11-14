import { describe, expect, it, vi } from 'vitest';
import type { DatasetClient } from '@hypequery/datasets';
import type { ProtocolBusinessContext } from '@hypequery/protocol';
import { HypequeryMCPExecutor } from './executor.js';
import { DATASET_LIST_OUTPUT_SCHEMA, BUSINESS_CONTEXT_OUTPUT_SCHEMA } from './tools/tool-manifest.js';
import { LIST_DATASETS_CONTEXT_INLINE_BYTES } from './utils/business-context.js';

const analytics = { execute: vi.fn() } as unknown as DatasetClient;
const datasets = {
  orders: { description: 'Orders', dimensions: { region: {} }, measures: { revenue: {} } },
};

const businessContext: ProtocolBusinessContext = {
  kind: 'hypequery-business-context',
  version: 1,
  summary: 'B2B analytics platform sold per seat.',
  kpis: [{ name: 'Net revenue', definition: 'Gross revenue minus refunds, in USD.' }],
  glossary: [{ term: 'Workspace', meaning: 'One paying customer account.' }],
  conventions: 'USD, UTC, fiscal year starts in February.',
  caveats: ['Orders before 2024-03 have no region.'],
};

function structured(result: { structuredContent?: unknown }): Record<string, unknown> {
  return result.structuredContent as Record<string, unknown>;
}

describe('HypequeryMCPExecutor business context', () => {
  it('lists get_business_context only when configured', async () => {
    const without = new HypequeryMCPExecutor({ datasets, analytics });
    const withContext = new HypequeryMCPExecutor({ datasets, analytics, businessContext });

    const names = async (executor: HypequeryMCPExecutor) =>
      (await executor.listTools()).tools.map(tool => tool.name);
    expect(await names(without)).not.toContain('get_business_context');
    expect(await names(withContext)).toContain('get_business_context');
    // Context is guidance only: it never changes the query contract.
    expect(withContext.getManifestHash()).toBe(without.getManifestHash());
  });

  it('carries the context in list_datasets and returns it from get_business_context', async () => {
    const executor = new HypequeryMCPExecutor({ datasets, analytics, businessContext });
    const { kind: _kind, version: _version, ...expected } = businessContext;

    const listed = structured(await executor.callTool('list_datasets'));
    expect(listed.businessContext).toEqual(expected);
    expect(listed.total).toBe(1);

    const got = await executor.callTool('get_business_context');
    expect(got.isError).toBeUndefined();
    expect(structured(got)).toEqual({ businessContext: expected });
  });

  it('keeps list_datasets unchanged without context, and refuses get_business_context', async () => {
    const executor = new HypequeryMCPExecutor({ datasets, analytics });
    expect(structured(await executor.callTool('list_datasets'))).not.toHaveProperty('businessContext');

    const refused = await executor.callTool('get_business_context');
    expect(refused.isError).toBe(true);
    expect(structured(refused)).toMatchObject({ error: { code: 'MCP_UNKNOWN_TOOL' } });
  });

  it('treats an empty document as no context', async () => {
    const executor = new HypequeryMCPExecutor({
      datasets,
      analytics,
      businessContext: { kind: 'hypequery-business-context', version: 1 },
    });
    expect((await executor.listTools()).tools.map(tool => tool.name)).not.toContain('get_business_context');
  });

  it('rejects an invalid document at construction', () => {
    expect(() => new HypequeryMCPExecutor({
      datasets,
      analytics,
      businessContext: {
        kind: 'hypequery-business-context',
        version: 1,
        glossary: [{ term: 'Seat', meaning: 'A user' }, { term: 'Seat', meaning: 'Twice' }],
      },
    })).toThrow();
  });

  it('lists only the summary when the context is too large to inline', async () => {
    const meaning = 'x'.repeat(4_000);
    const glossary = Array.from({ length: 10 }, (_, index) => ({ term: `Term ${index}`, meaning }));
    expect(JSON.stringify(glossary).length).toBeGreaterThan(LIST_DATASETS_CONTEXT_INLINE_BYTES);
    const executor = new HypequeryMCPExecutor({
      datasets,
      analytics,
      businessContext: { kind: 'hypequery-business-context', version: 1, summary: 'Big glossary.', glossary },
    });

    const listed = structured(await executor.callTool('list_datasets'));
    expect(listed.businessContext).toMatchObject({ summary: 'Big glossary.', truncated: true });
    expect(listed.businessContext).not.toHaveProperty('glossary');
    const full = structured(await executor.callTool('get_business_context'));
    expect((full.businessContext as { glossary: unknown[] }).glossary).toHaveLength(10);
  });

  it('declares the context in the output schemas', () => {
    const listSuccess = (DATASET_LIST_OUTPUT_SCHEMA as { oneOf: Array<{ properties: Record<string, unknown> }> }).oneOf[0];
    expect(listSuccess.properties).toHaveProperty('businessContext');
    const contextSuccess = (BUSINESS_CONTEXT_OUTPUT_SCHEMA as { oneOf: Array<{ required: string[] }> }).oneOf[0];
    expect(contextSuccess.required).toEqual(['businessContext']);
  });
});
