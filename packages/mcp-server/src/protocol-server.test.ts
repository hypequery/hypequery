import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';
import type { MCPToolExecutor } from './executor.js';
import { HypequeryMCPProtocolServer } from './protocol-server.js';

describe('HypequeryMCPProtocolServer', () => {
  it('serves an injected executor over an injected in-memory transport', async () => {
    const executor: MCPToolExecutor = {
      listTools: vi.fn(async () => ({
        tools: [{
          name: 'fixture_tool',
          description: 'Fixture tool',
          inputSchema: { type: 'object', properties: {} },
        }],
      })),
      callTool: vi.fn(async (name, args) => ({
        content: [{ type: 'text', text: JSON.stringify({ name, args }) }],
      })),
      listPrompts: vi.fn(async () => ({
        prompts: [{ name: 'fixture_prompt' }],
      })),
      getPrompt: vi.fn(async (name, args) => ({
        messages: [{
          role: 'user',
          content: { type: 'text', text: JSON.stringify({ name, args }) },
        }],
      })),
      getManifestHash: vi.fn(() => 'fixture-hash'),
    };
    const server = new HypequeryMCPProtocolServer({
      executor,
      name: 'in-memory-hypequery',
      version: '1.0.0',
    });
    const client = new Client(
      { name: 'test-client', version: '1.0.0' },
      { capabilities: {} },
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      expect(server.getManifestHash()).toBe('fixture-hash');
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      await expect(client.listTools()).resolves.toMatchObject({
        tools: [{ name: 'fixture_tool' }],
      });
      await expect(client.callTool({
        name: 'fixture_tool',
        arguments: { value: 42 },
      })).resolves.toMatchObject({
        content: [{ type: 'text', text: JSON.stringify({
          name: 'fixture_tool',
          args: { value: 42 },
        }) }],
      });
      await expect(client.listPrompts()).resolves.toMatchObject({
        prompts: [{ name: 'fixture_prompt' }],
      });
      await expect(client.getPrompt({
        name: 'fixture_prompt',
        arguments: { dataset: 'orders' },
      })).resolves.toMatchObject({
        messages: [{ role: 'user' }],
      });

      expect(executor.callTool).toHaveBeenCalledWith(
        'fixture_tool',
        { value: 42 },
        expect.any(AbortSignal),
      );
      expect(executor.getPrompt).toHaveBeenCalledWith('fixture_prompt', { dataset: 'orders' });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
