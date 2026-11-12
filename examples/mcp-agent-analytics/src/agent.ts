import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/**
 * A scripted "agent": the exact tool calls an LLM-driven client such as
 * Claude Code or Cursor makes, minus the model, so the walkthrough is
 * deterministic and runs in CI. Point a real agent at the same server with
 * the mcp.json in the README.
 */
export const RANGE: [string, string] = ['2026-10-02 00:00:00', '2026-10-31 23:59:59'];

export interface Transcript {
  tenantId: string;
  tools: string[];
  datasets: unknown;
  eventsSchemaMeasures: string[];
  eventsByType: unknown;
  subscriptionsByPlan: unknown;
  tenantFilterRefused: { ok: boolean; code?: string; message?: string };
}

export async function connect(tenantId: string): Promise<{ client: Client; close: () => Promise<void> }> {
  // Works from the compiled output (dist/src) and from the TypeScript source
  // under vitest: the server is always the compiled entry.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = here.endsWith(path.join('dist', 'src')) ? path.resolve(here, '..', '..') : path.resolve(here, '..');
  const serverEntry = path.join(root, 'dist', 'src', 'server.js');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    env: { ...(process.env as Record<string, string>), TENANT_ID: tenantId },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'scripted-agent', version: '0.1.0' });
  await client.connect(transport);
  return { client, close: () => client.close() };
}

type ToolResult = { structuredContent?: unknown; content?: Array<{ type: string; text?: string }>; isError?: boolean };

function payload(result: ToolResult): unknown {
  if (result.structuredContent !== undefined) return result.structuredContent;
  const text = result.content?.find((c) => c.type === 'text')?.text;
  return text ? JSON.parse(text) : null;
}

export async function runTranscript(tenantId: string): Promise<Transcript> {
  const { client, close } = await connect(tenantId);
  try {
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    const datasets = payload((await client.callTool({ name: 'list_datasets', arguments: {} })) as ToolResult);
    const schema = payload((await client.callTool({ name: 'get_dataset_schema', arguments: { dataset: 'events' } })) as ToolResult) as { measures?: Array<{ name: string }> | Record<string, unknown> };
    const eventsSchemaMeasures = Array.isArray(schema.measures)
      ? schema.measures.map((m) => m.name).sort()
      : Object.keys(schema.measures ?? {}).sort();

    const eventsByType = payload((await client.callTool({
      name: 'query_dataset',
      arguments: {
        dataset: 'events',
        dimensions: ['eventType'],
        measures: ['events', 'uniqueUsers', 'errorRate'],
        filters: [{ field: 'occurredAt', operator: 'between', value: RANGE }],
        orderBy: [{ field: 'events', direction: 'desc' }],
      },
    })) as ToolResult);

    const subscriptionsByPlan = payload((await client.callTool({
      name: 'query_dataset',
      arguments: { dataset: 'subscriptions', dimensions: ['plan', 'status'], measures: ['subscriptions', 'billedAmount'] },
    })) as ToolResult);

    // Governance check: the agent cannot pick another tenant.
    const refused = (await client.callTool({
      name: 'query_dataset',
      arguments: { dataset: 'events', measures: ['events'], filters: [{ field: 'tenantId', operator: 'eq', value: 1 }] },
    })) as ToolResult;
    const refusedBody = payload(refused) as { error?: { code?: string; message?: string } } | null;
    const tenantFilterRefused = {
      ok: Boolean(refused.isError || refusedBody?.error),
      code: refusedBody?.error?.code,
      message: refusedBody?.error?.message,
    };

    return { tenantId, tools, datasets, eventsSchemaMeasures, eventsByType, subscriptionsByPlan, tenantFilterRefused };
  } finally {
    await close();
  }
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const tenantId = process.env.TENANT_ID ?? '153';
  runTranscript(tenantId)
    .then((t) => {
      if (process.argv.includes('--json')) {
        console.log(JSON.stringify(t, null, 2));
        return;
      }
      console.log(`Agent transcript, tenant ${t.tenantId}\n`);
      console.log(`tools:    ${t.tools.join(', ')}`);
      console.log(`datasets: ${JSON.stringify(t.datasets)}`);
      console.log(`events measures: ${t.eventsSchemaMeasures.join(', ')}\n`);
      console.log('"How many events by type did we have in October, and the error rate?"');
      console.table((t.eventsByType as { data?: unknown[] })?.data ?? t.eventsByType);
      console.log('"Subscriptions by plan and status"');
      console.table((t.subscriptionsByPlan as { data?: unknown[] })?.data ?? t.subscriptionsByPlan);
      console.log(`"Show me tenant 1 instead" -> refused: ${t.tenantFilterRefused.ok} ${t.tenantFilterRefused.code ?? ''} ${t.tenantFilterRefused.message ?? ''}`);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
