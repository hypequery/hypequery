import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'ClickHouse MCP Server with Type-Safe Queries | hypequery',
  description:
    'Give AI agents a fixed, tenant-safe ClickHouse tool surface instead of raw SQL access.',
  alternates: {
    canonical: absoluteUrl('/clickhouse-mcp'),
  },
  openGraph: {
    type: 'website',
    url: absoluteUrl('/clickhouse-mcp'),
    title: 'ClickHouse MCP Server | Structured AI Agent Access | hypequery',
    description:
      'Connect AI agents to ClickHouse without exposing raw SQL. hypequery turns typed query definitions into MCP tools with tenant isolation built in.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClickHouse MCP Server | Structured AI Agent Access | hypequery',
    description:
      'Connect AI agents to ClickHouse without exposing raw SQL. hypequery turns typed query definitions into MCP tools with tenant isolation built in.',
  },
};

const queryCode = `import { initServe } from '@hypequery/serve';

const { query, serve } = initServe({
  context: (req) => ({
    db,
    tenantId: req.headers["x-tenant-id"] as string,
  }),
})

// tenant isolation is built into the query — the agent never sees it
export const dailyRevenue = query({
  query: async ({ ctx }) =>
    ctx.db.table("orders")
      .where("tenant_id", "=", ctx.tenantId)
      .select("order_date", "total_revenue")
      .groupBy("order_date")
      .execute()
})

// expose as HTTP API — OpenAPI spec auto-generated at /openapi.json
export const api = serve({ queries: { dailyRevenue } });`;

const mcpCode = `import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

const server = new McpServer({ name: "clickhouse-analytics", version: "1.0.0" })

server.tool(
  "dailyRevenue",
  "Get daily revenue for the current tenant",
  {},
  async () => {
    const data = await fetch("http://localhost:3000/dailyRevenue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }).then((r) => r.json())

    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    }
  }
)`;

export default function ClickHouseMcpPage() {
  return (
    <ClickhousePillarPage
      eyebrow="ClickHouse MCP"
      title="Connect AI agents to ClickHouse — without exposing raw SQL"
      description="This page is about choosing the tool surface an agent gets. If the model can write arbitrary SQL, your access control story is already weak. hypequery lets you expose a small set of named analytics queries instead."
      primaryCta={{ href: '/docs/http-openapi', label: 'Open serve docs' }}
      secondaryCta={{ href: '/blog/clickhouse-mcp-typescript', label: 'Read the full guide' }}
      stats={[
        { label: 'Agent access model', value: 'Structured tools' },
        { label: 'Tenant isolation', value: 'Query-level' },
        { label: 'Works with', value: 'Claude, Cursor, custom agents' },
      ]}
      problems={[
        {
          title: 'Raw SQL is the wrong primitive for agent access',
          copy:
            'If the model decides what to query directly, you have already handed over too much surface area. Prompt instructions are not a meaningful replacement for access control.',
        },
        {
          title: 'Agents work better with known result shapes',
          copy:
            'A named tool returning a predictable payload is much easier to reason over than arbitrary query output that changes shape from call to call.',
        },
        {
          title: 'A fixed tool surface is easier to review and audit',
          copy:
            'It is far easier to reason about five exposed analytics tools than a general database capability whose behavior depends on whatever the model asks for next.',
        },
      ]}
      solutionSection={{
        eyebrow: 'The safer model',
        title: 'Expose named analytics queries, not a database console',
        description:
          'Define a small set of queries with the same typed backend layer you would use for the rest of the app, expose them over HTTP, and register those endpoints as MCP tools. The agent only gets the capabilities you decided to publish.',
        bullets: [
          'Tenant isolation injected in the same request path as the rest of your analytics API',
          'Only explicitly exposed queries are reachable by the agent',
          'Input schemas stay next to the query definition instead of inside prompt text',
          'The same backend query layer can serve humans, dashboards, and agents',
          'The tool list stays small enough to review deliberately',
        ],
        codePanel: {
          eyebrow: 'Query definition',
          title: 'A served query the agent is allowed to call',
          description:
            'The useful part is that the agent never chooses the SQL. It only calls the query surface you already chose to expose.',
          code: queryCode,
        },
      }}
      implementationSection={{
        eyebrow: 'MCP server',
        title: 'Register a small tool surface on top of the API',
        description:
          'You do not need a magical agent-specific backend. In most cases, a straightforward MCP server that forwards to a few served analytics endpoints is the better design.',
        paragraphs: [
          'That is also easier to audit. The tool list is explicit, the HTTP surface is explicit, and the backend queries are the same ones your application code can already review and test.',
          'If you want to automate tool generation later, the OpenAPI surface makes that possible. The important architectural choice is still the same: expose named queries, not arbitrary SQL.',
        ],
        codePanel: {
          eyebrow: 'MCP server',
          title: 'A single MCP tool backed by a served analytics endpoint',
          description:
            'Start simple. Register one or two tools against the endpoints you trust, then expand deliberately if the agent use case proves valuable.',
          code: mcpCode,
        },
      }}
      searchIntentCards={[
        {
          title: 'What this page is really deciding',
          copy:
            'Not just how to wire MCP to ClickHouse, but what the agent should be allowed to do once it gets there.',
        },
        {
          title: 'What the safer default looks like',
          copy:
            'A short list of named analytics tools with tenant-scoped backend definitions is much safer than a model deciding which SQL to write.',
        },
        {
          title: 'Why this fits the rest of the stack',
          copy:
            'The same query layer can already serve dashboards and APIs, so the MCP surface does not need its own separate data-access architecture.',
        },
        {
          title: 'Where to go next',
          copy:
            'Use the serve/OpenAPI docs for the HTTP layer details and the full MCP guide for the end-to-end wiring pattern.',
        },
      ]}
      readingLinks={[
        {
          href: '/blog/clickhouse-mcp-typescript',
          title: 'ClickHouse MCP: full implementation guide',
          description: 'Step-by-step guide to building a typed MCP server on top of hypequery with tenant isolation.',
        },
        {
          href: '/docs/http-openapi',
          title: 'HTTP and OpenAPI docs',
          description: 'How @hypequery/serve exposes queries as HTTP endpoints and generates the OpenAPI spec.',
        },
        {
          href: '/blog/stop-writing-the-same-query-three-times',
          title: 'The query() API',
          description: 'How hypequery 0.2.0 makes one query definition run in inline, HTTP, and agent contexts.',
        },
        {
          href: '/clickhouse-query-builder',
          title: 'ClickHouse query builder',
          description: 'The typed query builder that backs the analytics layer your MCP server exposes.',
        },
      ]}
      relatedPillars={[
        { href: '/clickhouse-typescript', label: 'ClickHouse TypeScript' },
        { href: '/clickhouse-query-builder', label: 'ClickHouse Query Builder' },
        { href: '/clickhouse-analytics', label: 'ClickHouse Analytics' },
        { href: '/clickhouse-multi-tenant-analytics', label: 'ClickHouse Multi-Tenant Analytics' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Define the queries you want your agent to access',
        description:
          'Start with one or two analytics queries. Expose them via @hypequery/serve. Point your MCP server at the OpenAPI spec. Your agent has structured, tenant-safe access to ClickHouse.',
        primaryCta: { href: '/docs/http-openapi', label: 'Open serve docs' },
        secondaryCta: { href: '/blog/clickhouse-mcp-typescript', label: 'Read the full guide' },
      }}
    />
  );
}
