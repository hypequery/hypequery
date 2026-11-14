import { generateText, stepCountIs } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ROWS, startFixtureServer, TENANT_TOOLS, THROTTLED, type FixtureServer } from '../../test/fixture-server.js';
import { hypequeryTools } from './ai-sdk.js';
import { createHypequeryToolsClient } from './client.js';
import type { HypequeryToolsClient } from './types.js';

const TOKEN = 'agent-token-0123456789';
let server: FixtureServer;
let client: HypequeryToolsClient;

beforeEach(async () => {
  server = await startFixtureServer(TOKEN);
  client = createHypequeryToolsClient({ url: server.url, token: TOKEN });
});
afterEach(async () => {
  await client.close();
  await server.close();
});

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

/** A model that calls one tool, then answers with the tool result it was sent. */
function scriptedModel(toolName: string, input: Record<string, unknown>) {
  let step = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => {
      step += 1;
      if (step === 1) {
        return {
          content: [{ type: 'tool-call', toolCallId: 'call_1', toolName, input: JSON.stringify(input) }],
          finishReason: { unified: 'tool-calls', raw: 'tool_use' },
          usage,
          warnings: [],
        };
      }
      return {
        content: [{ type: 'text', text: 'done' }],
        finishReason: { unified: 'stop', raw: 'end_turn' },
        usage,
        warnings: [],
      };
    },
  });
}

describe('@hypequery/agent/ai-sdk', () => {
  it('lists the tenant tools with the server’s input schemas', async () => {
    const tools = await hypequeryTools(client);
    const listed = await server.executor.listTools();
    expect(Object.keys(tools)).toEqual(TENANT_TOOLS);

    const model = scriptedModel('list_datasets', {});
    await generateText({ model, tools, prompt: 'What can I query?', stopWhen: stepCountIs(2) });
    const sent = model.doGenerateCalls[0]!.tools!;
    expect(sent.map(tool => tool.name)).toEqual(TENANT_TOOLS);
    expect(sent.map(tool => (tool as { inputSchema: unknown }).inputSchema))
      .toEqual(listed.tools.map(tool => tool.inputSchema));
    expect(sent.map(tool => (tool as { description?: string }).description))
      .toEqual(listed.tools.map(tool => tool.description));
  });

  it('runs query_dataset in an agent loop with the bearer token', async () => {
    const tools = await hypequeryTools({ url: server.url, token: async () => TOKEN });
    const model = scriptedModel('query_dataset', { dataset: 'orders', dimensions: ['region'], measures: ['revenue'] });
    const result = await generateText({ model, tools, prompt: 'Revenue by region?', stopWhen: stepCountIs(2) });

    const toolResult = result.steps[0]!.toolResults[0]!;
    expect(toolResult.toolName).toBe('query_dataset');
    expect(toolResult.output).toMatchObject({ data: ROWS });
    expect(JSON.stringify(model.doGenerateCalls[1]!.prompt)).toContain('"revenue":340');
    expect(new Set(server.authorizations)).toEqual(new Set([`Bearer ${TOKEN}`]));
    expect(result.text).toBe('done');
  });

  it('returns a tool error to the model with its code and hint', async () => {
    const tools = await hypequeryTools(client);
    const model = scriptedModel('query_dataset', { dataset: 'throttled', measures: ['revenue'] });
    const result = await generateText({ model, tools, prompt: 'Revenue?', stopWhen: stepCountIs(2) });

    expect(result.steps[0]!.toolResults[0]!.output).toMatchObject({
      error: { code: THROTTLED.code, hint: THROTTLED.hint, docsUrl: THROTTLED.docsUrl, requestId: THROTTLED.requestId },
    });
    const prompt = JSON.stringify(model.doGenerateCalls[1]!.prompt);
    expect(prompt).toContain(THROTTLED.code);
    expect(prompt).toContain('Wait 30 seconds');
  });
});
