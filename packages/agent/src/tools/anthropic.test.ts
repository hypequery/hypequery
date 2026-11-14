import Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ROWS, startFixtureServer, TENANT_TOOLS, THROTTLED, type FixtureServer } from '../../test/fixture-server.js';
import { hypequeryTools } from './anthropic.js';

const TOKEN = 'agent-token-0123456789';
let server: FixtureServer;

beforeEach(async () => {
  server = await startFixtureServer(TOKEN);
});
afterEach(async () => {
  await server.close();
});

function message(content: unknown[], stopReason: string) {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-test',
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

/** An Anthropic client whose Messages API calls one tool, then answers. */
function scriptedAnthropic(toolName: string, input: Record<string, unknown>) {
  const requests: { tools?: unknown[]; messages: unknown[] }[] = [];
  const anthropic = new Anthropic({
    apiKey: 'test-key',
    maxRetries: 0,
    fetch: async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      const body = requests.length === 1
        ? message([
          { type: 'text', text: 'Let me check.' },
          { type: 'tool_use', id: 'toolu_1', name: toolName, input },
        ], 'tool_use')
        : message([{ type: 'text', text: 'done' }], 'end_turn');
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    },
  });
  return { anthropic, requests };
}

async function agentLoop(anthropic: Anthropic, hq: Awaited<ReturnType<typeof hypequeryTools>>) {
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: 'Revenue by region?' }];
  for (;;) {
    const response = await anthropic.messages.create({
      model: 'claude-test',
      max_tokens: 1024,
      tools: hq.tools,
      messages,
    });
    messages.push({ role: 'assistant', content: response.content });
    if (response.stop_reason !== 'tool_use') return { response, messages };
    messages.push({ role: 'user', content: await hq.toolResults(response.content) });
  }
}

describe('@hypequery/agent/anthropic', () => {
  it('lists the tenant tools with the server’s input schemas', async () => {
    const hq = await hypequeryTools({ url: server.url, token: TOKEN });
    const listed = await server.executor.listTools();
    expect(hq.tools.map(tool => tool.name)).toEqual(TENANT_TOOLS);
    expect(hq.tools.map(tool => tool.input_schema)).toEqual(listed.tools.map(tool => tool.inputSchema));
    expect(hq.tools.map(tool => tool.description)).toEqual(listed.tools.map(tool => tool.description));
    await hq.close();
  });

  it('runs query_dataset in a Messages API loop with the bearer token', async () => {
    const hq = await hypequeryTools({ url: server.url, token: () => TOKEN });
    const { anthropic, requests } = scriptedAnthropic('query_dataset', {
      dataset: 'orders', dimensions: ['region'], measures: ['revenue'],
    });
    const { response } = await agentLoop(anthropic, hq);

    expect(response.content).toEqual([{ type: 'text', text: 'done' }]);
    expect(requests[0]!.tools).toEqual(hq.tools);
    const sent = requests[1]!.messages.at(-1) as { content: { type: string; tool_use_id: string; content: string; is_error?: boolean }[] };
    expect(sent.content).toHaveLength(1);
    expect(sent.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_1' });
    expect(sent.content[0]!.is_error).toBeUndefined();
    expect(JSON.parse(sent.content[0]!.content)).toMatchObject({ data: ROWS });
    expect(new Set(server.authorizations)).toEqual(new Set([`Bearer ${TOKEN}`]));
    await hq.close();
  });

  it('answers a failed call with is_error and the envelope’s code and hint', async () => {
    const hq = await hypequeryTools({ url: server.url, token: TOKEN });
    const { anthropic, requests } = scriptedAnthropic('query_dataset', { dataset: 'throttled', measures: ['revenue'] });
    await agentLoop(anthropic, hq);

    const sent = requests[1]!.messages.at(-1) as { content: { content: string; is_error?: boolean }[] };
    expect(sent.content[0]!.is_error).toBe(true);
    expect(JSON.parse(sent.content[0]!.content)).toMatchObject({
      error: { code: THROTTLED.code, hint: THROTTLED.hint, docsUrl: THROTTLED.docsUrl, requestId: THROTTLED.requestId },
    });

    const direct = await hq.runTool('query_dataset', { dataset: 'throttled', measures: ['revenue'] });
    expect(direct).toMatchObject({ ok: false, error: { code: THROTTLED.code, hint: THROTTLED.hint } });
    await hq.close();
  });

  it('leaves tool_use blocks for other tools to the caller', async () => {
    const hq = await hypequeryTools({ url: server.url, token: TOKEN });
    const results = await hq.toolResults([
      { type: 'text', text: 'hi' },
      { type: 'tool_use', id: 'toolu_a', name: 'my_own_tool', input: {} },
      { type: 'tool_use', id: 'toolu_b', name: 'list_datasets', input: {} },
    ]);
    expect(results.map(result => result.tool_use_id)).toEqual(['toolu_b']);
    await hq.close();
  });
});
