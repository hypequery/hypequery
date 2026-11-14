import Link from 'next/link';
import { HubFaq, HubSection, HubShell, HubSources, HubTable } from '@/components/hub-page';
import {
  CodePair,
  SemanticLayerGuides,
  SemanticLayerNextStep,
  inlineCode,
  inlineLink,
  spokeArticleJsonLd,
  spokeBreadcrumbs,
  spokeMetadata,
} from '@/components/semantic-layer-parts';
import { marketing } from '@/components/ui/marketing';
import { faqJsonLd, type FaqItem } from '@/lib/structured-data';
import { updatedFor } from '@/data/page-dates';

const PATH = '/semantic-layer/analytics-mcp-server';
const TITLE = 'Analytics MCP Server: Database SQL Tools vs Semantic Layer Tools (2026)';
const DESCRIPTION =
  'What an analytics MCP server is, the two kinds (database servers that run SQL and semantic layer servers that query named metrics), how to evaluate one for production, and how ClickHouse, hypequery, Cube, dbt, Snowflake and AtScale servers compare.';
const UPDATED = updatedFor(PATH);
// Claims about other servers were checked on their own repositories or docs on this date. See seo-verification-log.md.
const VERIFIED_ON = 'November 14, 2026';

export const metadata = spokeMetadata({ path: PATH, title: TITLE, description: DESCRIPTION });

const sqlToolCode = `// A database MCP server: the agent writes SQL.
{
  "name": "run_query",
  "arguments": {
    "query": "SELECT country, sum(amount) FROM orders
              WHERE status != 'refunded'
              GROUP BY country"
  }
}

// The agent chose the table, the join, the definition
// of revenue and the refund rule. The next conversation
// may choose differently.`;

// Argument names from @hypequery/mcp's query_metric input schema.
const metricToolCode = `// A semantic layer MCP server: the agent names a metric.
{
  "name": "query_metric",
  "arguments": {
    "dataset": "orders",
    "metric": "revenue",
    "dimensions": ["country"],
    "grain": "month",
    "limit": 12
  }
}

// Revenue, the refund rule and the tenant filter are
// defined once, in code. The agent only picks names.`;

const kindsRows = [
  [
    'Database MCP server',
    'Lists databases and tables, runs SQL the agent writes',
    'Exploring data you already have access to; ad hoc questions by analysts and engineers',
    'Every answer re-derives business logic; access is whatever the database user can read',
  ],
  [
    'Semantic layer MCP server',
    'Lists metrics and dimensions with descriptions, runs queries by name',
    'Agents inside a product, or answers that must match the dashboard',
    'Only answers what has been modelled; someone has to write the model',
  ],
  [
    'BI tool MCP server',
    'Exposes saved dashboards, reports or charts, sometimes with editing tools',
    'Teams whose definitions already live in a BI tool',
    'Bound to that tool’s model and licence',
  ],
];

const evalRows = [
  [
    'What the agent can see',
    'A list of metrics and dimensions with labels and descriptions, returned by a schema tool.',
    'Table and column names only.',
  ],
  [
    'Whether it can write SQL',
    'No raw SQL tool, or one you can switch off and verify is off.',
    'A SQL tool that is always present, guarded only by a prompt.',
  ],
  [
    'Who decides the tenant',
    'The server, from its own config or the caller’s verified credential. Missing tenant means refusal.',
    'A tenant argument the agent fills in.',
  ],
  [
    'How it authenticates over HTTP',
    'OAuth or your app’s own auth, with each call run as the caller.',
    'One shared token for every user.',
  ],
  [
    'Result size',
    'A default row limit and a hard ceiling, and caps per call.',
    'Whatever the query returns.',
  ],
  [
    'Traceability',
    'The metric and filters used are returned, and the generated SQL is available for debugging.',
    'A number with no record of how it was computed.',
  ],
  [
    'Same numbers as the dashboard',
    'The agent and the dashboard read the same model.',
    'The agent computes its own version.',
  ],
];

const serverRows = [
  [
    'mcp-clickhouse (ClickHouse)',
    'Database',
    '`run_query`, `list_databases`, `list_tables`; `run_chdb_select_query` with chDB',
    'Yes: that is the tool. Read-only (`readonly=1`) by default; writes and drops behind flags',
    'stdio, Streamable HTTP; HTTP needs a bearer token or OAuth by default',
    'Apache 2.0',
  ],
  [
    'hypequery',
    'Semantic layer',
    '`list_datasets`, `get_dataset_schema`, `query_metric`, `query_dataset`',
    'None',
    'stdio, or HTTP with your app’s auth; tenant from server config or verified credential',
    'Apache 2.0; ClickHouse only',
  ],
  [
    'Cube',
    'Semantic layer and BI',
    '30 tools, including `runQuery` and data-model editing tools',
    '`runQuery` takes SQL, but in Cube’s Postgres dialect against its semantic SQL API, not the database directly',
    'Hosted in Cube Cloud over HTTPS with OAuth; Viewer role or higher; tokens can be limited to named tools',
    'All Cube Cloud plans',
  ],
  [
    'dbt MCP server',
    'Semantic layer plus dbt tools',
    'Semantic Layer tools (`list_metrics`, `get_dimensions`, `query_metrics` and more), plus CLI, Discovery and Admin API tools',
    'Yes: `execute_sql`, `text_to_sql` and CLI `show`, each can be disabled',
    'Local or remote; per-tool enable and disable settings',
    'Server Apache 2.0; Semantic Layer on a paid dbt plan; no ClickHouse',
  ],
  [
    'Snowflake-managed MCP server',
    'Semantic layer and database',
    'Cortex Analyst over semantic views, Cortex Search, Cortex Agents, custom tools',
    'Optional `SYSTEM_EXECUTE_SQL`, read-only by default',
    'Snowflake OAuth or an external IdP; Snowflake privileges per tool',
    'Snowflake',
  ],
  [
    'AtScale',
    'Semantic layer',
    '`list_models`, `explore_columns`, `run_query` and others',
    'Tools are read-only and checked against the model',
    'Remote MCP server',
    'Commercial; no ClickHouse',
  ],
];

const faqItems: FaqItem[] = [
  {
    question: 'What is an analytics MCP server?',
    answer:
      'It is a Model Context Protocol server that lets AI agents such as Claude, Cursor or Codex answer data questions. It publishes tools the agent can call: some list what data exists, others run queries. Database MCP servers run SQL the agent writes; semantic layer MCP servers run queries over named metrics and dimensions that someone defined in advance.',
  },
  {
    question: 'Is an analytics MCP server the same as text-to-SQL?',
    answer:
      'A database MCP server is text-to-SQL with a standard interface: the model writes SQL and the server runs it. A semantic layer MCP server is different: the model chooses a metric, dimensions, filters and a time grain, and the layer writes the SQL. The second gives the same answer every time and cannot reach data outside the model.',
  },
  {
    question: 'Should I use the ClickHouse MCP server or a semantic layer MCP server?',
    answer:
      'Use mcp-clickhouse for exploration by people who already have database access: it is read-only by default, quick to set up and can answer questions nobody modelled. Use a semantic layer server, such as hypequery, when the agent is part of your product, serves customers, or must agree with your dashboards. Many teams run both, for different audiences.',
  },
  {
    question: 'What should an analytics MCP server expose to an agent?',
    answer:
      'A tool to list the available datasets or metrics, a tool to describe one (dimensions, measures, descriptions, allowed filters), and one or two tools to query by name. Leave out raw SQL tools for any agent that serves people outside your data team, and leave out write tools entirely unless editing is the point.',
  },
  {
    question: 'How do permissions work with an analytics MCP server?',
    answer:
      'For a database server, permissions are the database user’s grants: give it a read-only user that can see only what the agent should. For a semantic layer server, the layer applies tenant and row rules from the caller’s verified credential to every query it builds. Either way, permissions should never depend on the prompt.',
  },
  {
    question: 'Can an analytics MCP server be used in a multi-tenant SaaS product?',
    answer:
      'Yes, if the tenant comes from the server and not the agent. In hypequery, a stdio server is started for one tenant, and an HTTP server reads each caller’s tenant from their verified credential. A tenant-keyed dataset with no trusted tenant refuses to start, and tenant filters sent by the agent are rejected.',
  },
];

const sources = [
  {
    vendor: 'ClickHouse',
    urls: ['https://github.com/ClickHouse/mcp-clickhouse'],
  },
  {
    vendor: 'hypequery',
    urls: [
      'https://github.com/hypequery/hypequery/tree/main/packages/mcp-server',
      'https://hypequery.com/docs/mcp/safety',
      'https://hypequery.com/docs/mcp/tools',
    ],
  },
  {
    vendor: 'Cube',
    urls: ['https://github.com/cube-js/cube/blob/master/docs-mintlify/docs/integrations/mcp-server.mdx'],
  },
  {
    vendor: 'dbt Labs',
    urls: ['https://github.com/dbt-labs/dbt-mcp/blob/main/README.md', 'https://docs.getdbt.com/docs/use-dbt-semantic-layer/sl-faqs'],
  },
  {
    vendor: 'Snowflake',
    urls: ['https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-mcp'],
  },
  {
    vendor: 'AtScale',
    urls: ['https://www.atscale.com/use-cases/semantic-context-ai-mcp/', 'https://www.atscale.com/integrations/'],
  },
];

export default function AnalyticsMcpServerPage() {
  return (
    <HubShell
      path={PATH}
      breadcrumbs={spokeBreadcrumbs('Analytics MCP server')}
      eyebrow="Semantic layer"
      title="Analytics MCP servers: SQL tools or metric tools"
      updated={UPDATED}
      lead={
        <p>
          An analytics MCP server lets an AI agent answer data questions. The big choice is what its tools accept:
          SQL the agent writes, or the names of metrics you defined. This guide covers both kinds, what to check before
          production, and how the main servers compare.
        </p>
      }
      primaryCta={{ href: '#kinds', label: 'The two kinds', target: 'analytics_mcp_kinds' }}
      secondaryCta={{ href: '#servers', label: 'Compare servers', target: 'analytics_mcp_servers' }}
      definition={{
        term: 'What is an analytics MCP server?',
        body: (
          <>
            <p>
              MCP, the Model Context Protocol, is how agents discover and call tools. An analytics MCP server publishes
              tools for data: one to list what exists, one to describe it, and one or more to query it. The agent picks
              a tool, fills in the arguments and gets rows back.
            </p>
            <p>
              A database MCP server&rsquo;s query tool takes SQL. A semantic layer MCP server&rsquo;s query tool takes
              a metric, dimensions, filters and a time grain, and the layer writes the SQL. That one difference decides
              how consistent the answers are and how far the agent can reach.
            </p>
          </>
        ),
      }}
      jsonLd={[spokeArticleJsonLd({ path: PATH, title: TITLE, description: DESCRIPTION, dateModified: UPDATED }), faqJsonLd(faqItems)]}
    >
      <HubSection id="kinds" eyebrow="The two kinds" title="Database servers and semantic layer servers">
        <HubTable
          caption="Kinds of analytics MCP server"
          columns={['Kind', 'What the tools do', 'Good for', 'Watch out for']}
          rows={kindsRows}
        />
      </HubSection>

      <HubSection
        band
        eyebrow="Side by side"
        title="The same question, two tool calls"
        intro={
          <p>
            Both calls answer &ldquo;revenue by country&rdquo;. In the first, the agent decided what revenue means. In
            the second, it asked for a metric that has one definition, shared with your API and dashboards.
          </p>
        }
      >
        <CodePair
          left={{ code: sqlToolCode, filename: 'database MCP server', language: 'javascript' }}
          right={{ code: metricToolCode, filename: 'semantic layer MCP server', language: 'javascript' }}
        />
      </HubSection>

      <HubSection
        id="evaluate"
        eyebrow="Before production"
        title="Seven things to check in an analytics MCP server"
      >
        <HubTable
          caption="How to evaluate an analytics MCP server"
          columns={['Check', 'Good', 'Risky']}
          rows={evalRows}
        />
        <p className="mt-4 text-sm leading-6 text-text-muted">
          For the access-control side in more depth, see{' '}
          <Link href="/semantic-layer/access-control" className={inlineLink}>
            data access control in a semantic layer
          </Link>
          .
        </p>
      </HubSection>

      <HubSection
        id="servers"
        band
        eyebrow="Options"
        title="Analytics MCP servers compared"
        intro={
          <p>
            Checked against each project&rsquo;s own repository or docs on {VERIFIED_ON}. &ldquo;Not covered&rdquo;
            means the sources we read did not say, not that the feature is missing. For semantic layers that also run
            MCP, such as Boring Semantic Layer, Malloy Publisher and Wren AI, see{' '}
            <Link href="/semantic-layer/ai-agents" className={inlineLink}>
              semantic layer for AI agents
            </Link>
            .
          </p>
        }
      >
        <HubTable
          caption={`Analytics MCP servers, checked ${VERIFIED_ON}`}
          columns={['Server', 'Kind', 'Tools', 'Raw SQL', 'Transport and auth', 'Licence, plan or databases']}
          rows={serverRows}
        />
      </HubSection>

      <HubSection
        id="clickhouse"
        eyebrow="On ClickHouse"
        title="Use both, for different people"
        intro={
          <>
            <p>
              On ClickHouse, the two kinds are complementary. ClickHouse&rsquo;s own{' '}
              <code className={inlineCode}>mcp-clickhouse</code> runs queries with{' '}
              <code className={inlineCode}>readonly=1</code> by default and needs auth over HTTP by default, which suits
              engineers exploring a cluster they can already query. Its docs call the drop guard a best-effort guard,
              not a security boundary, and recommend limiting the ClickHouse user&rsquo;s grants.
            </p>
            <p>
              For an agent that answers your customers, or one whose numbers must match the product,{' '}
              <Link href="/clickhouse-mcp" className={inlineLink}>
                hypequery&rsquo;s MCP server
              </Link>{' '}
              exposes only the datasets you published, with no SQL tool, a tenant set by the server, 100 rows per call
              by default and a ceiling you choose.
            </p>
          </>
        }
      >
        <div className="grid gap-5 md:grid-cols-3">
          <div className={marketing.card}>
            <h3 className="text-[17px] font-medium tracking-tight text-text">Exploration</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              mcp-clickhouse with a read-only ClickHouse user, for your data team in Claude or Cursor.
            </p>
          </div>
          <div className={marketing.card}>
            <h3 className="text-[17px] font-medium tracking-tight text-text">Product agents</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              hypequery datasets over MCP, scoped per tenant, sharing definitions with your API and React hooks.
            </p>
          </div>
          <div className={marketing.card}>
            <h3 className="text-[17px] font-medium tracking-tight text-text">Promotion path</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              When an exploratory query keeps coming back, turn it into a dataset measure, so every agent gets the
              same answer.
            </p>
          </div>
        </div>
      </HubSection>

      <HubSection
        band
        eyebrow="An honest answer"
        title="When another option fits better"
        intro={
          <ul className="list-disc space-y-2 pl-5">
            <li>
              Questions are one-off and the askers are engineers: a database MCP server answers things nobody modelled,
              with no setup beyond a read-only user.
            </li>
            <li>
              Your metrics already live in dbt on a supported warehouse: the dbt MCP server reuses them. Switch off its
              SQL and CLI tools for a governed agent.
            </li>
            <li>
              You want agents to build dashboards and edit the model, not only query: Cube&rsquo;s hosted server
              includes model-editing tools.
            </li>
            <li>Everything is in Snowflake: its managed MCP server keeps tools and privileges inside Snowflake.</li>
          </ul>
        }
      />

      <HubSection eyebrow="Questions" title="Analytics MCP server FAQ">
        <HubFaq items={faqItems} />
      </HubSection>

      <SemanticLayerGuides currentHref={PATH} />
      <HubSources checkedOn={VERIFIED_ON} sources={sources} />
      <SemanticLayerNextStep location="analytics_mcp_next_step" />
    </HubShell>
  );
}
