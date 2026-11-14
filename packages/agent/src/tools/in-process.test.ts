import { createMCPExecutor } from '@hypequery/mcp';
import { generateText, stepCountIs } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';
import { hypequeryTools as anthropicTools } from './anthropic.js';
import { hypequeryTools } from './ai-sdk.js';
import { resolveToolsClient } from './client.js';
import { HypequeryToolsError } from './errors.js';
import { createInProcessToolsClient } from './in-process.js';
import type { HypequeryToolExecutor, HypequeryToolResult } from './types.js';

const ROWS = [{ region: 'EU', revenue: 340 }];
const CLOUD_TENANT_TOOLS = ['list_datasets', 'get_dataset_schema', 'query_dataset', 'get_business_context'];

function executorFor(tenantId: string) {
  const execute = vi.fn(async () => ({ data: ROWS, meta: {} }));
  const executor = createMCPExecutor({
    datasets: {
      orders: { description: 'Orders by region', dimensions: { region: {} }, measures: { revenue: {} } },
    } as never,
    analytics: { execute } as never,
    tenantId,
    businessContext: {
      kind: 'hypequery-business-context',
      version: 1,
      summary: 'Marketplace for vintage furniture.',
      glossary: [{ term: 'GMV', meaning: 'Gross merchandise value, before refunds.' }],
    },
  });
  return { executor, execute };
}

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

function scriptedModel(toolName: string, input: Record<string, unknown>) {
  let step = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => {
      step += 1;
      return step === 1
        ? {
          content: [{ type: 'tool-call', toolCallId: 'call_1', toolName, input: JSON.stringify(input) }],
          finishReason: { unified: 'tool-calls', raw: 'tool_use' },
          usage,
          warnings: [],
        }
        : { content: [{ type: 'text', text: 'done' }], finishReason: { unified: 'stop', raw: 'end_turn' }, usage, warnings: [] };
    },
  });
}

describe('in-process tools ({ executor })', () => {
  it('lists the executor’s tools, including get_business_context', async () => {
    const { executor } = executorFor('tenant_a');
    const tools = await hypequeryTools({ executor });
    expect(Object.keys(tools)).toEqual([...(await executor.listTools()).tools.map(tool => tool.name)]);
    expect(Object.keys(tools)).toContain('get_business_context');
  });

  it('runs query_dataset in an agent loop, scoped to the executor’s tenant', async () => {
    const { executor, execute } = executorFor('tenant_a');
    const tools = await hypequeryTools({ executor });
    const model = scriptedModel('query_dataset', { dataset: 'orders', dimensions: ['region'], measures: ['revenue'] });
    const result = await generateText({ model, tools, prompt: 'Revenue by region?', stopWhen: stepCountIs(2) });

    expect(result.steps[0]!.toolResults[0]!.output).toMatchObject({ data: ROWS });
    expect(execute).toHaveBeenCalledTimes(1);
    expect((execute.mock.calls[0] as unknown[])[2]).toMatchObject({ runtime: { tenant: { id: 'tenant_a' } } });
  });

  it('gives the model the business context from list_datasets', async () => {
    const { executor } = executorFor('tenant_a');
    const tools = await hypequeryTools({ executor });
    const model = scriptedModel('list_datasets', {});
    await generateText({ model, tools, prompt: 'What can I query?', stopWhen: stepCountIs(2) });
    expect(JSON.stringify(model.doGenerateCalls[1]!.prompt)).toContain('Gross merchandise value, before refunds.');
  });

  it('restricts to an allowlist: others are neither listed nor callable', async () => {
    const { executor } = executorFor('tenant_a');
    const results: HypequeryToolResult[] = [];
    const client = createInProcessToolsClient({ executor, tools: CLOUD_TENANT_TOOLS, onResult: r => results.push(r) });

    expect((await client.listTools()).map(tool => tool.name)).toEqual(CLOUD_TENANT_TOOLS);
    const refused = await client.callTool('query_metric', { metric: 'x' });
    expect(refused).toMatchObject({ ok: false, error: { code: 'MCP_UNKNOWN_TOOL', retryable: false, correctable: true } });
    expect(results).toEqual([refused]);
  });

  it('returns tool errors as results, like the HTTP client', async () => {
    const { executor } = executorFor('tenant_a');
    const client = createInProcessToolsClient({ executor });
    await expect(client.callTool('get_dataset_schema', { dataset: 'missing' })).resolves.toMatchObject({
      ok: false,
      error: { category: 'correctable_input' },
    });
  });

  it('rejects when the executor throws, and on abort', async () => {
    const broken: HypequeryToolExecutor = {
      listTools: async () => { throw new Error('boom'); },
      callTool: () => new Promise(() => {}),
    };
    const client = createInProcessToolsClient({ executor: broken });
    await expect(client.listTools()).rejects.toBeInstanceOf(HypequeryToolsError);

    const controller = new AbortController();
    const pending = client.callTool('list_datasets', {}, { signal: controller.signal });
    controller.abort(new Error('stopped'));
    await expect(pending).rejects.toThrow('stopped');
  });

  it('works with every adapter, since they share the source', async () => {
    const { executor } = executorFor('tenant_a');
    const hq = await anthropicTools({ executor });
    expect(hq.tools.map(tool => tool.name)).toContain('query_dataset');
  });

  it('refuses a bare executor passed where a client was expected', () => {
    const { executor } = executorFor('tenant_a');
    expect(() => resolveToolsClient(executor as never)).toThrow(/as \{ executor \}/);
  });

  it('validates its options', () => {
    expect(() => createInProcessToolsClient({ executor: {} as never })).toThrow(TypeError);
    const { executor } = executorFor('tenant_a');
    expect(() => createInProcessToolsClient({ executor, tools: 'list_datasets' as never })).toThrow(TypeError);
  });
});
