import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl, ogImage } from '@/lib/site';

export const metadata: Metadata = {
  title: 'ClickHouse MCP Server: 5-Minute Quickstart for Claude, Cursor, Codex',
  description:
    'A governed ClickHouse MCP server: agents query named datasets and metrics, never raw SQL. Run it in five minutes against the public ClickHouse playground.',
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

const quickstartConfig = `// mcp-config.mjs
import { createQueryBuilder } from '@hypequery/clickhouse';
import { createDatasetClient, dataset, dimension, measure, publishDatasets } from '@hypequery/datasets';

const db = createQueryBuilder({
  url: process.env.CLICKHOUSE_URL ?? 'https://play.clickhouse.com',
  username: process.env.CLICKHOUSE_USERNAME ?? 'play',
  password: process.env.CLICKHOUSE_PASSWORD ?? '',
  database: process.env.CLICKHOUSE_DATABASE ?? 'default',
  // The playground user is readonly = 1, which rejects the setting hypequery
  // normally sends to quote 64-bit integers. Use the server default instead.
  integerJsonEncoding: 'server-default',
});

const Flights = dataset('flights', {
  source: 'ontime',
  description: 'US domestic flights, one row per flight (public ClickHouse playground).',
  limits: { maxResultSize: 1000 },
  dimensions: {
    year: dimension.number({ column: 'Year', label: 'Year' }),
    airline: dimension.string({ column: 'Reporting_Airline', label: 'Airline code' }),
    origin: dimension.string({ column: 'OriginCityName', label: 'Origin city' }),
  },
  measures: {
    flights: measure.count('Year', { label: 'Flights' }),
    avgDepartureDelay: measure.avg('DepDelay', { label: 'Average departure delay (minutes)' }),
  },
});

const avgDepartureDelay = Flights.metric('avgDepartureDelay', { measure: 'avgDepartureDelay' });
const flightCount = Flights.metric('flights', { measure: 'flights' });

export const datasets = publishDatasets()
  .publish(Flights, { metrics: { avgDepartureDelay, flightCount } })
  .build();

export const analytics = createDatasetClient({ queryBuilder: db });`;

export default function ClickHouseMcpPage() {
  return (
    <ClickhousePillarPage
      eyebrow="ClickHouse MCP"
      title="Give AI agents trusted ClickHouse analytics — not a database console"
      description="@hypequery/mcp turns the datasets you define in TypeScript or Python into Model Context Protocol tools. Claude, Cursor, and other MCP clients can discover and query the analytics you approve, while SQL and ClickHouse credentials stay inside your server."
      primaryCta={{ href: '/docs/mcp/overview', label: 'Start with MCP' }}
      secondaryCta={{ href: '/docs/mcp/safety', label: 'Read the safety model' }}
      quickstart={{
        eyebrow: 'Quickstart',
        title: 'Run a ClickHouse MCP server in five minutes',
        description:
          'No ClickHouse install needed: this uses the public ClickHouse playground and its 200-million-row US flights table. The agent gets two metrics and three dimensions as tools, not a SQL console.',
        steps: [
          {
            title: 'Install the packages',
            description: 'Any empty folder works. You need Node.js 20 or newer.',
            code: `mkdir clickhouse-mcp && cd clickhouse-mcp
npm init -y
npm install @hypequery/mcp @hypequery/datasets @hypequery/clickhouse`,
            filename: 'terminal',
            language: 'bash',
          },
          {
            title: 'Define what the agent may query',
            description:
              'Save this as mcp-config.mjs. The dataset names the table, the columns an agent can group by, and the metrics it can ask for.',
            code: quickstartConfig,
            filename: 'mcp-config.mjs',
          },
          {
            title: 'Connect your agent',
            description:
              'Claude Code shown here. Cursor and Codex take the same command; see the setup guides below.',
            code: `claude mcp add clickhouse -- npx -y @hypequery/mcp --config "$PWD/mcp-config.mjs"
claude mcp list`,
            filename: 'terminal',
            language: 'bash',
          },
          {
            title: 'Ask a question',
            description:
              'The agent calls list_datasets, get_dataset_schema and query_dataset. In our run it returned JetBlue (B6) first: 23.5 minutes over 64,860 flights, the same as running the SQL directly. (The playground\'s 2022 data covers January to March.)',
            code: `Which airline had the highest average departure delay in 2022?`,
            filename: 'prompt',
            language: 'text',
          },
        ],
        footnote:
          'To use your own ClickHouse, set CLICKHOUSE_URL, CLICKHOUSE_USERNAME, CLICKHOUSE_PASSWORD and CLICKHOUSE_DATABASE, remove integerJsonEncoding unless your user is readonly = 1, and point the dataset at your table.',
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
          '@hypequery/mcp exposes list_datasets, get_dataset_schema, and query_dataset tools over stdio. The agent never writes or receives SQL.',
        paragraphs: [
          'hypequery mcp serves the datasets your Serve API already registers. A Python backend works too: the CLI bridges its client contract. Use the standalone server when you want a dedicated config for the agent.',
          'Because MCP queries go through the same dataset definitions as the rest of your application, validation and the meaning of each measure do not fork into an agent-only implementation.',
        ],
        codePanel: {
          eyebrow: '@hypequery/mcp',
          title: 'One Serve API, one MCP command',
          description:
            'Each server process runs as one trusted tenant, and tenant-scoped datasets refuse to start without one. Never ask the model to choose its own tenant.',
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
          href: '/docs/mcp/overview',
          title: 'MCP quick start',
          description: 'Install @hypequery/mcp and expose your first dataset.',
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
        {
          href: '/blog/clickhouse-mcp-typescript',
          title: 'ClickHouse MCP: Give Your AI Agent Type-Safe Access to Analytics Data',
          description: 'Build a ClickHouse MCP server around named analytics queries instead of raw SQL so tenant scope and response shapes stay under control.',
        },
      ]}
      relatedPillars={[
        { href: '/clickhouse-semantic-layer', label: 'ClickHouse Semantic Layer' },
        { href: '/clickhouse-multi-tenant-analytics', label: 'Multi-Tenant Analytics' },
        { href: '/clickhouse-react', label: 'ClickHouse React' },
        { href: '/clickhouse-python-mcp', label: 'MCP for Python backends' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Give one approved dataset to your first agent',
        description:
          'Install @hypequery/mcp, register a dataset with Serve, then connect hypequery mcp to your MCP client.',
        primaryCta: { href: '/docs/mcp/overview', label: 'Open the MCP guide' },
        secondaryCta: { href: '/docs/mcp/safety', label: 'Review safety' },
      }}
    />
  );
}
