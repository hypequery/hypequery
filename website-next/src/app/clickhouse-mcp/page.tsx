import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl, ogImage } from '@/lib/site';

export const metadata: Metadata = {
  title: 'ClickHouse MCP Server for Claude, Cursor and Codex',
  description:
    'A governed ClickHouse MCP server: agents query named datasets and metrics, never raw SQL. Connect Claude, Cursor or Codex to your own ClickHouse in five minutes, from TypeScript or Python.',
  alternates: {
    canonical: absoluteUrl('/clickhouse-mcp'),
  },
  openGraph: {
    images: ogImage('ClickHouse MCP Server for Governed AI Analytics'),
    type: 'website',
    url: absoluteUrl('/clickhouse-mcp'),
    title: 'ClickHouse MCP Server for AI Agents | hypequery',
    description:
      'Turn a TypeScript semantic layer into validated ClickHouse MCP tools for Claude, Cursor, and other AI agents.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClickHouse MCP Server for AI Agents | hypequery',
    description:
      'Give AI agents approved ClickHouse datasets instead of raw SQL access.',
  },
};

const datasetCode = `import { dataset, dimension, measure } from '@hypequery/datasets';

export const Orders = dataset('orders', {
  source: 'orders',
  tenantKey: 'tenant_id',
  timeKey: 'created_at',
  dimensions: {
    region: dimension.string(),
    status: dimension.string(),
  },
  measures: {
    revenue: measure.sum('amount', {
      description: 'Total completed order revenue',
    }),
    orderCount: measure.count('id'),
  },
});`;

const mcpCode = `// analytics/api.ts
import { initServe } from '@hypequery/serve';
import { db } from './client';
import { Orders } from './datasets';

const { serve } = initServe({ context: () => ({ db }) });

export const api = serve({
  queryBuilder: db,
  datasets: { orders: Orders },
});

// Expose the same datasets to Claude, Cursor, or any MCP client.
// The tenant comes from how you start the server, never from the model:
//   npx hypequery mcp --tenant acme`;

const quickstartApi = `// analytics/api.ts
import { createQueryBuilder } from '@hypequery/clickhouse';
import { dataset, dimension, measure } from '@hypequery/datasets';
import { initServe } from '@hypequery/serve';

// Reads CLICKHOUSE_URL, _USERNAME, _PASSWORD and _DATABASE from .env
const db = createQueryBuilder({
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

const Orders = dataset('orders', {
  source: 'orders',
  description: 'One row per order.',
  dimensions: {
    status: dimension.string({ label: 'Status', description: 'completed, refunded or pending' }),
    country: dimension.string({ label: 'Country' }),
  },
  measures: {
    revenue: measure.sum('amount', { label: 'Revenue' }),
    orders: measure.count('id', { label: 'Orders' }),
  },
});

const { serve } = initServe({ context: () => ({ db }) });

export const api = serve({ queryBuilder: db, datasets: { orders: Orders } });`;

export default function ClickHouseMcpPage() {
  return (
    <ClickhousePillarPage
      leadPage="/clickhouse-mcp"
      eyebrow="ClickHouse MCP"
      title="Give AI agents trusted ClickHouse analytics — not a database console"
      description="@hypequery/mcp turns the datasets you define in TypeScript or Python into Model Context Protocol tools. Claude, Cursor, and other MCP clients can discover and query the analytics you approve, while SQL and ClickHouse credentials stay inside your server."
      primaryCta={{ href: '/docs/mcp/quickstart', label: 'Start with MCP' }}
      secondaryCta={{ href: '/docs/mcp/safety', label: 'Read the safety model' }}
      quickstart={{
        eyebrow: 'Quickstart',
        title: 'Run a ClickHouse MCP server in five minutes',
        description:
          'Point it at a ClickHouse table you already have. The agent gets the dimensions and measures you define as tools, not a SQL console.',
        steps: [
          {
            title: 'Install the packages',
            description: 'In your project folder. You need Node.js 20 or newer.',
            code: `npm install @hypequery/clickhouse @hypequery/datasets @hypequery/serve @hypequery/mcp
npm install -D @hypequery/cli`,
            filename: 'terminal',
            language: 'bash',
          },
          {
            title: 'Define what the agent may query',
            description:
              'Save this as analytics/api.ts, with your ClickHouse settings in .env. The dataset names the table, the columns an agent can group and filter by, and the measures it can ask for. Swap in your own table.',
            code: quickstartApi,
            filename: 'analytics/api.ts',
          },
          {
            title: 'Connect your agent',
            description:
              'Claude Code shown here; run it from your project folder. `npx hypequery mcp --self-test` checks the setup first.',
            code: `claude mcp add hypequery -- sh -c "cd '$PWD' && npx hypequery mcp"
claude mcp list`,
            filename: 'terminal',
            language: 'bash',
            alternative: {
              description:
                'Using Claude Desktop? Open Settings → Developer → Edit Config, add this entry with your project\'s absolute path, then fully quit and reopen Claude so it starts the server.',
              code: `{
  "mcpServers": {
    "hypequery": {
      "command": "sh",
      "args": ["-c", "cd /absolute/path/to/your-project && npx hypequery mcp"]
    }
  }
}`,
              filename: 'claude_desktop_config.json',
              language: 'json',
            },
          },
          {
            title: 'Ask a question',
            description:
              'The agent calls list_datasets, get_dataset_schema and query_dataset, and answers from the rows hypequery returns.',
            code: `What was revenue by country for completed orders?`,
            filename: 'prompt',
            language: 'text',
          },
        ],
        footnote:
          'Using Python? The same four steps with `hypequery mcp app:api` are in the MCP quickstart. Add `--http` to serve it over HTTP for your team.',
      }}
      stats={[
        { label: 'Agent surface', value: 'Datasets and measures' },
        { label: 'Database access', value: 'No raw SQL' },
        { label: 'Works with', value: 'Claude, Cursor, MCP clients' },
      ]}
      problems={[
        {
          title: 'Raw SQL gives an agent too much authority',
          copy:
            'Prompt instructions are not an access-control layer. A general SQL tool lets the model choose tables, columns, joins, and result size at runtime.',
        },
        {
          title: 'Analytics meaning drifts between humans and agents',
          copy:
            'If every agent writes its own revenue query, it will disagree with the backend and dashboard sooner or later.',
        },
        {
          title: 'Multi-tenant data needs trusted scope',
          copy:
            'Tenant identity must come from the host process, never from a prompt or caller-supplied filter that can widen access.',
        },
      ]}
      solutionSection={{
        eyebrow: 'One governed contract',
        title: 'Publish the analytics definitions your product already trusts',
        description:
          'Define dimensions, measures, relationships, and tenant rules once, in TypeScript or Python. The MCP server turns that catalog into a small, discoverable tool surface.',
        bullets: [
          'Agents discover only the datasets you register, with the descriptions you write',
          'Fields, filters, ordering, and limits are validated before execution',
          'Measure definitions stay identical across backend, React, and MCP',
          'SQL is hidden by default and credentials never enter the model context',
          'Tenant-scoped datasets fail closed without trusted server scope',
        ],
        codePanel: {
          eyebrow: 'Semantic contract',
          title: 'Define what the agent is allowed to understand',
          description:
            'The dataset is ordinary code that can be reviewed, tested, and versioned with the rest of your application. Descriptions reach the agent through the schema tool.',
          code: datasetCode,
        },
      }}
      implementationSection={{
        eyebrow: 'MCP server',
        title: 'Serve your datasets, then expose them over MCP',
        description:
          '@hypequery/mcp exposes list_datasets, get_dataset_schema, and query_dataset tools over stdio or HTTP. The agent never writes or receives SQL.',
        paragraphs: [
          'hypequery mcp serves the datasets your Serve API already registers, and hypequery mcp app:api does the same for a Python API. Add --http to serve them at a URL, behind a shared key, your app\'s auth or OAuth.',
          'Because MCP queries go through the same dataset definitions as the rest of your application, validation and the meaning of each measure do not fork into an agent-only implementation.',
        ],
        codePanel: {
          eyebrow: '@hypequery/mcp',
          title: 'One Serve API, one MCP command',
          description:
            'Over stdio the server runs as one trusted tenant; over HTTP each caller\'s tenant comes from their verified credential. Tenant-scoped datasets refuse to run without one, and the model never chooses its own tenant.',
          code: mcpCode,
        },
      }}
      searchIntentCards={[
        {
          title: 'ClickHouse MCP server',
          copy:
            'Use a semantic tool surface when agents need ClickHouse analytics but should not receive general database access.',
        },
        {
          title: 'Semantic layer for AI agents',
          copy:
            'Datasets give humans, APIs, dashboards, and agents one definition for business metrics.',
        },
        {
          title: 'MCP for multi-tenant SaaS',
          copy:
            'The server accepts tenant identity from trusted host configuration and rejects unscoped tenant datasets.',
        },
        {
          title: 'Claude and Cursor analytics',
          copy:
            'Any MCP-compatible client can discover approved datasets and measures without learning your schema or credentials.',
        },
      ]}
      readingLinks={[
        {
          href: '/blog/clickhouse-mcp-servers-compared',
          title: 'Official ClickHouse MCP vs governed MCP',
          description: 'What the official mcp-clickhouse server, the ClickHouse Cloud remote MCP server and a governed MCP server each expose to agents.',
        },
        {
          href: '/blog/clickhouse-mcp-claude-code',
          title: 'ClickHouse MCP in Claude Code',
          description: 'Set up a governed ClickHouse MCP server in Claude Code, step by step, with verification and troubleshooting.',
        },
        {
          href: '/blog/clickhouse-mcp-cursor',
          title: 'ClickHouse MCP in Cursor',
          description: 'Add the server to .cursor/mcp.json for one project or every project.',
        },
        {
          href: '/blog/clickhouse-mcp-codex',
          title: 'ClickHouse MCP in Codex',
          description: 'Register the server with codex mcp add or ~/.codex/config.toml.',
        },
        {
          href: '/docs/mcp/quickstart',
          title: 'MCP quick start',
          description: 'Expose your first dataset from TypeScript or Python, then share it over HTTP.',
        },
        {
          href: '/docs/mcp/tools',
          title: 'MCP tool catalog',
          description: 'See exactly what agents can discover and execute.',
        },
        {
          href: '/docs/mcp/safety',
          title: 'MCP safety model',
          description: 'Credentials, SQL visibility, limits, and tenant isolation.',
        },
        {
          href: '/docs/datasets/tool-generation',
          title: 'AI tool generation',
          description: 'Generate tool schemas from the same semantic catalog.',
        },
      ]}
      relatedPillars={[
        { href: '/clickhouse', label: 'ClickHouse with TypeScript and Python' },
        { href: '/clickhouse-semantic-layer', label: 'ClickHouse Semantic Layer' },
        { href: '/clickhouse-multi-tenant-analytics', label: 'Multi-Tenant Analytics' },
        { href: '/clickhouse-react', label: 'ClickHouse React' },
        { href: '/clickhouse-python-mcp', label: 'MCP for Python backends' },
        { href: '/semantic-layer/ai-agents', label: 'AI semantic layer' },
        { href: '/semantic-layer/analytics-mcp-server', label: 'Analytics MCP server' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Give one approved dataset to your first agent',
        description:
          'Install @hypequery/mcp, register a dataset with Serve, then connect hypequery mcp to your MCP client.',
        primaryCta: { href: '/docs/mcp/quickstart', label: 'Open the MCP quickstart' },
        secondaryCta: { href: '/docs/mcp/safety', label: 'Review safety' },
      }}
    />
  );
}
