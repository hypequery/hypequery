import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'ClickHouse MCP Server with Type-Safe Queries | hypequery',
  description:
    'Give AI agents structured, tenant-safe access to ClickHouse. hypequery generates an MCP-ready API from typed query definitions. No arbitrary SQL exposure.',
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

const queryCode = `const { query, serve } = initServe({
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
serve({ queries: { dailyRevenue } }).listen(3000)`;

const mcpCode = `import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

// MCP server reads the OpenAPI spec and registers each query as a tool
const spec = await fetch("http://localhost:3000/openapi.json").then(r => r.json())

const server = new McpServer({ name: "clickhouse-analytics", version: "1.0.0" })

for (const [path, methods] of Object.entries(spec.paths)) {
  const get = (methods as any).get
  if (!get) continue
  const toolName = path.replace("/", "")
  server.tool(toolName, get.description, {}, async () => {
    const data = await fetch(\`http://localhost:3000\${path}\`).then(r => r.json())
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] }
  })
}`;

export default function ClickHouseMcpPage() {
  return (
    <ClickhousePillarPage
      eyebrow="ClickHouse MCP"
      title="Connect AI agents to ClickHouse — without exposing raw SQL"
      description="hypequery turns typed ClickHouse query definitions into an MCP-ready HTTP API. Your AI agent calls structured tools, not arbitrary SQL. Tenant isolation and access control are built in at the query level."
      primaryCta={{ href: '/docs/http-openapi', label: 'Read the serve docs' }}
      secondaryCta={{ href: '/blog/clickhouse-mcp-typescript', label: 'Read the full guide' }}
      stats={[
        { label: 'Agent access model', value: 'Structured tools' },
        { label: 'Tenant isolation', value: 'Query-level' },
        { label: 'Works with', value: 'Claude, Cursor, custom agents' },
      ]}
      problems={[
        {
          title: 'Arbitrary SQL access has no tenant isolation',
          copy:
            'If the model can write any SQL, it can read any tenant\'s data. Prompt engineering is not access control. Pre-defined query objects are.',
        },
        {
          title: 'The agent has no predictable response shape',
          copy:
            'Without pre-defined output types, the agent guesses what structure it gets back. Inconsistent responses break agent reasoning and make outputs unreliable.',
        },
        {
          title: 'You have no audit trail over what ran',
          copy:
            'Arbitrary SQL execution means you have no record of what queries an agent ran or what data it accessed. Pre-defined tools give you a fixed, auditable surface.',
        },
      ]}
      solutionSection={{
        eyebrow: 'How hypequery + MCP works',
        title: 'Pre-defined queries become MCP tools automatically',
        description:
          'Define your queries with hypequery. Expose them via @hypequery/serve — it generates an OpenAPI spec at /openapi.json. Your MCP server reads that spec and registers each query as a tool. The agent calls tools, not SQL.',
        bullets: [
          'Tenant isolation injected at the query level — agents cannot bypass it',
          'Access control enforced at the serve layer — only exposed queries are reachable',
          'OpenAPI spec auto-generated — no manual MCP tool registration needed',
          'Input schemas from Zod definitions become typed tool parameters',
          'Add a new query to serve({ queries }) — it appears as a new tool automatically',
        ],
        codePanel: {
          eyebrow: 'Query definition',
          title: 'Typed queries with tenant isolation built in',
          description:
            'The agent never sees the WHERE clause. It just calls the tool. Tenant context is injected from the request headers — enforced at the query level, not in a prompt.',
          code: queryCode,
        },
      }}
      implementationSection={{
        eyebrow: 'MCP server',
        title: 'Read the OpenAPI spec, register tools automatically',
        description:
          'Because hypequery generates a standard OpenAPI spec, the MCP server can discover tools dynamically. No hard-coded tool list. No manual sync between the analytics layer and the agent layer.',
        paragraphs: [
          'The agent sees named tool functions — dailyRevenue(), topProducts() — not a raw database. It gets structured responses with predictable shapes that it can reason over reliably.',
          'Input parameters from Zod schemas flow through to the MCP tool registration. The agent can call parameterised queries with type-checked arguments.',
        ],
        codePanel: {
          eyebrow: 'MCP server',
          title: 'Auto-register tools from the OpenAPI spec',
          description:
            'This MCP server reads the hypequery OpenAPI spec and registers each endpoint as a tool. Add a query to your analytics layer — it becomes a tool without touching this file.',
          code: mcpCode,
        },
      }}
      searchIntentCards={[
        {
          title: 'ClickHouse MCP server',
          copy:
            'If you want a ClickHouse MCP server, the question is whether to expose raw SQL or pre-defined query tools. For production or multi-tenant systems, pre-defined tools are the right default.',
        },
        {
          title: 'Give Claude access to ClickHouse',
          copy:
            'Claude can call MCP tools to query analytics data. hypequery makes this safe by defining the query surface explicitly — Claude calls tools, not arbitrary SQL.',
        },
        {
          title: 'MCP TypeScript analytics',
          copy:
            'The stable pattern for MCP + analytics databases is: define typed queries on the server, expose them via HTTP, generate MCP tools from the OpenAPI spec. hypequery handles the middle layer.',
        },
        {
          title: 'AI agent ClickHouse access control',
          copy:
            'Access control for AI agents should not live in the prompt. It should live at the query definition level, where it\'s enforced regardless of what the model asks.',
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
