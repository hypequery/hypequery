import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl, ogImage } from '@/lib/site';

export const metadata: Metadata = {
  title: 'ClickHouse MCP Server for Claude, Cursor and Codex',
  description:
    'A ClickHouse MCP server with tenant-scoped dataset tools in place of a SQL tool. Setup for Claude Desktop, Claude Code, Cursor and Codex.',
  alternates: {
    canonical: absoluteUrl('/clickhouse-mcp'),
  },
  openGraph: {
    images: ogImage('ClickHouse MCP Server for Claude, Cursor and Codex'),
    type: 'website',
    url: absoluteUrl('/clickhouse-mcp'),
    title: 'ClickHouse MCP Server for Claude, Cursor and Codex | hypequery',
    description:
      'Give Claude, Cursor and Codex named ClickHouse datasets and metrics as MCP tools, never raw SQL, from TypeScript or Python.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClickHouse MCP Server for Claude, Cursor and Codex | hypequery',
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
      title="A ClickHouse MCP server with tenant-scoped dataset tools"
      description="The official ClickHouse MCP servers give an agent a read-only SQL tool. @hypequery/mcp gives it four tools over the datasets you define in TypeScript or Python: it picks dimensions and measures, the server writes the SQL, and every query is held to one tenant. Claude, Cursor, Codex and other MCP clients connect over stdio or HTTP, and ClickHouse credentials stay in your server."
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
      comparisonMatrix={{
        eyebrow: 'Which ClickHouse MCP server',
        title: 'Official ClickHouse MCP servers and hypequery compared',
        description:
          'ClickHouse maintains two MCP servers. Both hand the agent SQL. hypequery hands it named datasets and metrics instead, so the questions it can answer are the ones you defined, for one tenant at a time.',
        columns: [
          { label: 'mcp-clickhouse (open source)' },
          { label: 'ClickHouse Cloud remote MCP' },
          { label: 'hypequery MCP', highlight: true },
        ],
        rows: [
          {
            label: 'What the agent sends',
            cells: ['SQL through run_query', 'SELECT statements through run_select_query', 'Dataset, dimensions, measures and filters; no SQL tool'],
          },
          {
            label: 'Tools',
            cells: [
              'run_query, list_databases, list_tables, run_chdb_select_query',
              'run_select_query, list_databases, list_tables, plus organization and service tools',
              'list_datasets, get_dataset_schema, query_metric, query_dataset',
            ],
          },
          {
            label: 'Writes',
            cells: ['Read-only by default; writes and drops can be switched on', 'All queries read-only', 'Read-only: queries come from dataset definitions'],
          },
          {
            label: 'Tenant scope',
            cells: ['The ClickHouse user’s grants', 'The ClickHouse user’s grants', 'Tenant key per dataset; unscoped queries are refused'],
          },
          {
            label: 'Where it runs',
            cells: ['Your machine or server (Python)', 'Hosted by ClickHouse Cloud', 'Your backend (TypeScript or Python), stdio or HTTP'],
          },
          {
            label: 'Best for',
            cells: ['Exploring a database you own', 'Exploring a ClickHouse Cloud service', 'Agents that answer business questions, including for your customers'],
          },
        ],
        footnote:
          'ClickHouse columns checked on 2026-11-18 against the mcp-clickhouse README and the ClickHouse Cloud remote MCP guide, both linked in the sources below.',
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
          '@hypequery/mcp exposes four tools over stdio or HTTP: list_datasets, get_dataset_schema, query_metric and query_dataset. The agent never writes or receives SQL.',
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
      additionalSections={[
        {
          eyebrow: 'Client setup',
          title: 'Connect Claude Desktop, Claude Code, Cursor or Codex',
          description:
            'Each client launches the same command, `npx hypequery mcp`, from your project folder. Add `--tenant <id>` if any dataset is tenant-scoped. Run `npx hypequery mcp --self-test` first to check which datasets it will serve.',
          paragraphs: [
            'Desktop clients start servers from their own working directory, so every entry changes into your project first and uses an absolute path. For a Python API, run `hypequery mcp app:api --print-config` and paste the entry it prints. The clients guide in the docs covers Windows and the config-file server.',
          ],
          codePanels: [
            {
              eyebrow: 'Claude Code',
              title: 'Add it from your project folder',
              description: 'The shell expands $PWD, so Claude Code stores an absolute path.',
              code: `claude mcp add hypequery -- sh -c "cd '$PWD' && npx hypequery mcp"
claude mcp list`,
              filename: 'terminal',
              language: 'bash',
            },
            {
              eyebrow: 'Claude Desktop',
              title: 'Edit claude_desktop_config.json',
              description:
                'Settings → Developer → Edit Config. On macOS the file is ~/Library/Application Support/Claude/claude_desktop_config.json. Quit and reopen Claude afterwards.',
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
            {
              eyebrow: 'Cursor',
              title: 'Add .cursor/mcp.json to the project',
              description: 'Cursor fills in ${workspaceFolder} with the folder you opened.',
              code: `{
  "mcpServers": {
    "hypequery": {
      "type": "stdio",
      "command": "sh",
      "args": ["-c", "cd '\${workspaceFolder}' && npx hypequery mcp"]
    }
  }
}`,
              filename: '.cursor/mcp.json',
              language: 'json',
            },
            {
              eyebrow: 'Codex',
              title: 'Register it with codex mcp add',
              description:
                'Run it from your project folder. Codex writes the entry to ~/.codex/config.toml, which the CLI, the IDE extension and the ChatGPT desktop app share.',
              code: `codex mcp add hypequery -- sh -c "cd '$PWD' && npx hypequery mcp"
codex mcp list`,
              filename: 'terminal',
              language: 'bash',
            },
          ],
        },
      ]}
      searchIntentCards={[
        {
          title: 'Is there an official ClickHouse MCP server?',
          copy:
            'Yes, two. ClickHouse maintains mcp-clickhouse, an open-source Python server with a run_query tool that is read-only by default, and ClickHouse Cloud hosts a remote MCP server at mcp.clickhouse.cloud with a SELECT-only run_select_query tool. hypequery is the option for agents that should call named datasets and metrics, scoped to one tenant, instead of writing SQL.',
        },
        {
          title: 'Semantic layer for AI agents',
          copy:
            'Datasets give humans, APIs, dashboards, and agents one definition for business metrics.',
        },
        {
          title: 'How do I keep an AI agent to one tenant’s data?',
          copy:
            'The server accepts tenant identity from trusted host configuration and rejects unscoped tenant datasets.',
        },
        {
          title: 'Can Claude or Cursor query ClickHouse?',
          copy:
            'Yes, through an MCP server. With this one, Claude, Cursor, Codex and other MCP clients discover approved datasets and measures without learning your schema or credentials.',
        },
      ]}
      sources={[
        { href: 'https://github.com/ClickHouse/mcp-clickhouse', label: 'mcp-clickhouse README (ClickHouse, checked 2026-11-18)' },
        {
          href: 'https://clickhouse.com/docs/products/cloud/features/ai-ml/mcp/remote-mcp',
          label: 'ClickHouse Cloud remote MCP server guide (checked 2026-11-18)',
        },
      ]}
      readingLinks={[
        {
          href: '/docs/mcp/clients',
          title: 'MCP client setup',
          description: 'Claude Code, Claude Desktop, Cursor and Python entries, Windows paths and the config-file server.',
        },
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
          href: '/blog/clickhouse-ai-chat-vercel-ai-sdk',
          title: 'AI analytics chat with the Vercel AI SDK',
          description: 'Use the same MCP tools inside your own product, with streamText and useChat.',
        },
        {
          href: '/docs/mcp/quickstart',
          title: 'MCP quick start',
          description: 'Expose your first dataset from TypeScript or Python, then share it over HTTP.',
        },
        {
          href: '/docs/mcp/quickstart#take-it-to-production',
          title: 'Take it to production',
          description: 'Per-user auth so each caller sees only their tenant, OAuth for Claude and ChatGPT, HTTPS and hosting.',
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
        { href: '/clickhouse-ai', label: 'ClickHouse AI chat' },
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
