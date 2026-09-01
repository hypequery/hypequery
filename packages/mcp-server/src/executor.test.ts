import { describe, expect, it, vi } from 'vitest';
import type { DatasetClient } from '@hypequery/datasets';
import { HypequeryMCPExecutor } from './executor.js';

describe('HypequeryMCPExecutor', () => {
  const analytics = {
    execute: vi.fn(),
  } as unknown as DatasetClient;

  const datasets = {
    orders: {
      description: 'Orders',
      dimensions: { region: {} },
      measures: { revenue: {} },
      metrics: { totalRevenue: {} },
    },
  };

  it('exposes tools and prompts without constructing a transport', async () => {
    const executor = new HypequeryMCPExecutor({ datasets, analytics });

    await expect(executor.listTools()).resolves.toMatchObject({
      tools: [
        { name: 'list_datasets' },
        { name: 'get_dataset_schema' },
        { name: 'query_metric' },
        { name: 'query_dataset' },
      ],
    });
    await expect(executor.listPrompts()).resolves.toMatchObject({
      prompts: [{ name: 'dataset_guide' }],
    });
    expect(executor.getManifestHash()).toMatch(/^[a-f0-9]{64}$/);
  });

  it('executes tools and prompts directly', async () => {
    const executor = new HypequeryMCPExecutor({ datasets, analytics });

    const toolResult = await executor.callTool('list_datasets');
    expect(JSON.parse(toolResult.content[0].type === 'text' ? toolResult.content[0].text : '')).toMatchObject({
      total: 1,
      datasets: [{ name: 'orders' }],
    });

    await expect(executor.getPrompt('dataset_guide', { dataset: 'orders' })).resolves.toMatchObject({
      messages: [{ role: 'user' }],
    });
  });

  it('returns tool errors as MCP results', async () => {
    const executor = new HypequeryMCPExecutor({ datasets, analytics });

    await expect(executor.callTool('unknown')).resolves.toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'Error: Unknown tool: unknown' }],
    });
  });
});
