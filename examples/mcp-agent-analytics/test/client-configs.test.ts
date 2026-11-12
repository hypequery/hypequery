import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { describe, expect, it } from 'vitest';

/**
 * The checked-in client configs must start the server as written: Claude Code
 * launches .mcp.json from the project root, Cursor expands ${workspaceFolder}.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

interface ServerConfig { command: string; args: string[]; env: Record<string, string> }

function load(file: string): ServerConfig {
  const config = JSON.parse(readFileSync(path.join(root, file), 'utf8')) as { mcpServers: Record<string, ServerConfig> };
  return config.mcpServers['hypequery-seed-analytics'];
}

async function toolsFrom(server: ServerConfig): Promise<{ tools: string[]; events: number }> {
  const transport = new StdioClientTransport({
    command: server.command === 'node' ? process.execPath : server.command,
    args: server.args.map((a) => a.replace('${workspaceFolder}', root)),
    // CI may point CLICKHOUSE_* elsewhere; the config's own values otherwise.
    env: { ...server.env, ...(process.env as Record<string, string>), TENANT_ID: server.env.TENANT_ID },
    cwd: root,
    stderr: 'pipe',
  });
  const client = new Client({ name: 'config-check', version: '0.1.0' });
  await client.connect(transport);
  try {
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    const result = (await client.callTool({ name: 'query_dataset', arguments: { dataset: 'events', measures: ['events'] } })) as {
      structuredContent?: { data: Array<{ events: string }> };
    };
    return { tools, events: Number(result.structuredContent?.data[0].events) };
  } finally {
    await client.close();
  }
}

describe('ready-to-paste client configs', () => {
  for (const file of ['.mcp.json', '.cursor/mcp.json']) {
    it(`${file} starts the governed server for tenant 153`, async () => {
      const server = load(file);
      expect(server.env.TENANT_ID).toBe('153');
      const { tools, events } = await toolsFrom(server);
      expect(tools).toEqual(['get_dataset_schema', 'list_datasets', 'query_dataset', 'query_metric']);
      expect(events).toBeGreaterThan(0);
    });
  }
});
