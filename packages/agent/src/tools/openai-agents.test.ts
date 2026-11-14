import { Agent, run, setTracingDisabled } from '@openai/agents';
import { assistantMessage, functionCall, ScriptedModel } from '@openai/agents/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ROWS, startFixtureServer, TENANT_TOOLS, THROTTLED, type FixtureServer } from '../../test/fixture-server.js';
import { createHypequeryToolsClient } from './client.js';
import { hypequeryTools } from './openai-agents.js';
import type { HypequeryToolsClient } from './types.js';

const TOKEN = 'agent-token-0123456789';
let server: FixtureServer;
let client: HypequeryToolsClient;

// Never export traces from tests, even with OPENAI_API_KEY set.
setTracingDisabled(true);

beforeEach(async () => {
  server = await startFixtureServer(TOKEN);
  client = createHypequeryToolsClient({ url: server.url, token: async () => TOKEN });
});
afterEach(async () => {
  await client.close();
  await server.close();
});

function scriptedModel(toolName: string, input: Record<string, unknown>) {
  return new ScriptedModel([
    [functionCall(toolName, input, { callId: 'call_1' })],
    [assistantMessage('done')],
  ]);
}

function toolOutput(model: ScriptedModel): string {
  const input = model.calls[1]!.request.input;
  const items = Array.isArray(input) ? input : [];
  const output = items.find(item => (item as { type?: string }).type === 'function_call_result') as
    { output: { type: string; text: string } | string } | undefined;
  if (output === undefined) throw new Error('no function_call_result sent to the model');
  return typeof output.output === 'string' ? output.output : output.output.text;
}

describe('@hypequery/agent/openai-agents', () => {
  it('lists the tenant tools with the server’s input schemas, not strict', async () => {
    const tools = await hypequeryTools(client);
    const listed = await server.executor.listTools();
    expect(tools.map(tool => tool.name)).toEqual(TENANT_TOOLS);
    expect(tools.map(tool => tool.parameters)).toEqual(listed.tools.map(tool => tool.inputSchema));
    expect(tools.map(tool => tool.description)).toEqual(listed.tools.map(tool => tool.description));
    expect(tools.every(tool => tool.strict === false)).toBe(true);

    const model = scriptedModel('list_datasets', {});
    await run(new Agent({ name: 'Analyst', model, tools }), 'What can I query?');
    const sent = model.calls[0]!.request.tools as { name: string; parameters: unknown }[];
    expect(sent.map(tool => tool.parameters)).toEqual(listed.tools.map(tool => tool.inputSchema));
  });

  it('runs query_dataset in an agent run with the bearer token', async () => {
    const tools = await hypequeryTools(client);
    const model = scriptedModel('query_dataset', { dataset: 'orders', dimensions: ['region'], measures: ['revenue'] });
    const result = await run(new Agent({ name: 'Analyst', model, tools }), 'Revenue by region?');

    expect(result.finalOutput).toBe('done');
    expect(JSON.parse(toolOutput(model))).toMatchObject({ data: ROWS });
    expect(new Set(server.authorizations)).toEqual(new Set([`Bearer ${TOKEN}`]));
  });

  it('returns a tool error to the model with its code and hint', async () => {
    const tools = await hypequeryTools(client);
    const model = scriptedModel('query_dataset', { dataset: 'throttled', measures: ['revenue'] });
    await run(new Agent({ name: 'Analyst', model, tools }), 'Revenue?');

    expect(JSON.parse(toolOutput(model))).toMatchObject({
      error: { code: THROTTLED.code, hint: THROTTLED.hint, docsUrl: THROTTLED.docsUrl, requestId: THROTTLED.requestId },
    });
  });
});
