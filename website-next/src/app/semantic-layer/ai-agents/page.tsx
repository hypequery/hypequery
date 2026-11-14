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

const PATH = '/semantic-layer/ai-agents';
const TITLE = 'Semantic Layer for AI Agents: Governed Metrics over MCP (2026)';
const DESCRIPTION =
  'Why AI agents need a semantic layer instead of raw text-to-SQL, what to look for in one (named metrics, no raw SQL tool, tenant scope, query limits), and how hypequery, Cube, dbt, AtScale, Snowflake and others expose metrics to agents over MCP.';
const UPDATED = updatedFor(PATH);
// Every vendor claim was checked on the vendor's own site, docs or repository on this date. See seo-verification-log.md.
const VERIFIED_ON = 'November 13, 2026';

export const metadata = spokeMetadata({ path: PATH, title: TITLE, description: DESCRIPTION });

// Type-checked against @hypequery/datasets 0.31.0 on 2026-11-13.
const datasetCode = `// analytics/datasets.ts
import { dataset, dimension, measure } from '@hypequery/datasets';

export const Orders = dataset('orders', {
  source: 'orders',
  tenantKey: 'tenant_id',
  timeKey: 'created_at',
  description: 'One row per order.',
  dimensions: {
    country: dimension.string({ label: 'Country' }),
    status: dimension.string({
      label: 'Status',
      description: 'completed, refunded or pending',
    }),
    createdAt: dimension.timestamp({ column: 'created_at' }),
  },
  measures: {
    revenue: measure.sum('amount', { label: 'Revenue' }),
    orders: measure.count('id', { label: 'Orders' }),
  },
});

export const revenue = Orders.metric('revenue', { measure: 'revenue' });`;

// Argument names from @hypequery/mcp's query_metric input schema.
const toolCallCode = `// The agent calls a tool; it never writes SQL.
// tools: list_datasets, get_dataset_schema,
//        query_metric, query_dataset
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

// The server adds the tenant from its own config or the
// caller's verified credential. A tenant filter sent by
// the agent is rejected, and a tenant-keyed dataset
// with no tenant configured refuses to start.`;

const checklistRows = [
  [
    'Named metrics with descriptions',
    'The agent picks “revenue” from a list instead of guessing which column and filter make revenue.',
    'Labels and descriptions on every dimension and measure, returned by a schema tool.',
  ],
  [
    'Query tools, not a SQL console',
    'An agent that can run any SELECT can join the wrong tables or read columns you never meant to share.',
    'Tools that take metric and dimension names. If a raw SQL tool exists, you can leave it off.',
  ],
  [
    'Tenant scope that fails closed',
    'In a multi-tenant product, one missing WHERE clause shows a customer someone else’s data.',
    'The tenant comes from the server or the caller’s credential, never from tool arguments, and an unscoped query fails.',
  ],
  [
    'Bounded queries',
    'Agents retry and explore. Unbounded result sets cost money and flood the context window.',
    'Default and maximum row limits, and caps on dimensions and measures per call.',
  ],
  [
    'One definition for every consumer',
    'If the agent’s revenue differs from the dashboard’s, people stop trusting both.',
    'The same model serves dashboards, APIs and agents.',
  ],
];

const optionsRows = [
  [
    'hypequery',
    '@hypequery/mcp (TypeScript) or the Python package: stdio, or HTTP with your app’s auth',
    'list_datasets, get_dataset_schema, query_metric, query_dataset',
    'None',
    'Tenant from server config or the caller’s verified credential; tenant filters from the agent are rejected',
    'ClickHouse only',
    'Apache 2.0',
  ],
  [
    'Cube',
    'Hosted MCP server in Cube Cloud',
    '30 tools, including tools that edit the data model',
    '`runQuery` takes Cube SQL (Postgres dialect) against the semantic SQL API, not the database directly',
    'Viewer role or higher; tools shown by role; tokens can be limited to named tools',
    'Many sources, including ClickHouse',
    'All Cube Cloud plans',
  ],
  [
    'dbt Semantic Layer',
    'dbt MCP server',
    'list_metrics, get_dimensions, query_metrics and other Semantic Layer tools, plus dbt CLI, Discovery and Admin API tools',
    'Yes: execute_sql, text_to_sql and the CLI show tool; each can be switched off or left out of an allowlist',
    'Per-tool enable and disable settings',
    'Snowflake, BigQuery, Databricks, Redshift, Postgres, Trino (no ClickHouse)',
    'Server Apache 2.0; Semantic Layer needs a paid dbt plan',
  ],
  [
    'AtScale',
    'Remote MCP server',
    'list_models, explore_columns, run_query and others',
    'Tools are read-only; every request is checked against the model',
    'Checked against the AtScale model',
    'Snowflake, Databricks, BigQuery, Redshift, PostgreSQL and more (no ClickHouse)',
    'Commercial',
  ],
  [
    'Snowflake semantic views',
    'Snowflake-managed MCP server',
    'Cortex Analyst over semantic views, Cortex Search, Cortex Agents, UDFs and procedures',
    'Optional SYSTEM_EXECUTE_SQL tool, read-only by default; Snowflake advises keeping it off a governed agent’s server',
    'Snowflake privileges per tool; Snowflake OAuth or an external IdP',
    'Snowflake',
    'Commercial',
  ],
  [
    'Boring Semantic Layer',
    'Built-in MCP server (MCPSemanticModel)',
    'list_models, get_model, get_time_range, query_model, compare_periods',
    'None listed',
    'Not covered in its docs',
    'Ibis backends such as DuckDB, Snowflake, BigQuery and PostgreSQL',
    'MIT',
  ],
  [
    'GoodData',
    'MCP server',
    '30+ tools',
    'Not covered in sources checked',
    'Not covered in sources checked',
    '23 sources, including ClickHouse',
    'Enterprise plan only',
  ],
];

const faqItems: FaqItem[] = [
  {
    question: 'Why do AI agents need a semantic layer?',
    answer:
      'Without one, an agent writes SQL from table and column names. It has to guess which tables to join, how a metric like revenue is calculated, and which rows a user may see. A semantic layer gives it named metrics and dimensions with descriptions, so it asks for revenue by country and the layer writes the SQL the same way every time.',
  },
  {
    question: 'Is text-to-SQL enough for an analytics agent?',
    answer:
      'For an analyst exploring a warehouse they already have access to, often yes. For an agent inside a product, it is risky: the agent can read any table its credentials reach, compute a metric differently from your dashboard, or leave out a tenant filter. Query tools over named metrics remove those choices from the agent.',
  },
  {
    question: 'What is an MCP server for a semantic layer?',
    answer:
      'MCP, the Model Context Protocol, is how agents such as Claude, Cursor and Codex discover and call tools. A semantic layer’s MCP server turns its model into tools: one to list datasets or metrics, one to describe them, and one or more to query them by name.',
  },
  {
    question: 'How do I stop an agent from seeing another customer’s data?',
    answer:
      'Take the tenant out of the agent’s hands. The server should get the tenant from its own configuration or from the caller’s verified credential, apply it to every query, and fail when it is missing. In hypequery, a dataset with a tenant key cannot be served over MCP without a trusted tenant, and tenant filters sent by the agent are rejected.',
  },
  {
    question: 'Which semantic layers have an MCP server?',
    answer:
      'Of the tools on this page: hypequery (@hypequery/mcp and the Python package), Cube (a hosted MCP server on all Cube Cloud plans), dbt (the dbt MCP server), AtScale (a remote MCP server with read-only tools), Snowflake (a managed MCP server that can call Cortex Analyst over semantic views), Boring Semantic Layer (built in) and GoodData (on its Enterprise plan). Malloy Publisher and Wren AI, covered in the open-source tools guide, also serve MCP.',
  },
];

const sources = [
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
    urls: [
      'https://github.com/cube-js/cube/blob/master/docs-mintlify/docs/integrations/mcp-server.mdx',
      'https://github.com/cube-js/cube/blob/master/docs-mintlify/admin/connect-to-data/data-sources/clickhouse.mdx',
    ],
  },
  {
    vendor: 'dbt Labs',
    urls: [
      'https://github.com/dbt-labs/dbt-mcp/blob/main/README.md',
      'https://docs.getdbt.com/docs/use-dbt-semantic-layer/sl-faqs',
    ],
  },
  {
    vendor: 'AtScale',
    urls: ['https://www.atscale.com/use-cases/semantic-context-ai-mcp/', 'https://www.atscale.com/integrations/'],
  },
  {
    vendor: 'Snowflake',
    urls: [
      'https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-mcp',
      'https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-analyst',
    ],
  },
  {
    vendor: 'Boring Semantic Layer',
    urls: [
      'https://github.com/boringdata/boring-semantic-layer',
      'https://github.com/boringdata/boring-semantic-layer/blob/main/docs/md/doc/query-agent-mcp.md',
    ],
  },
  {
    vendor: 'GoodData',
    urls: ['https://www.gooddata.ai/pricing/', 'https://www.gooddata.ai/docs/cloud/connect-data/'],
  },
];

export default function SemanticLayerAiAgentsPage() {
  return (
    <HubShell
      path={PATH}
      breadcrumbs={spokeBreadcrumbs('AI agents')}
      eyebrow="Semantic layer"
      title="A semantic layer for AI agents"
      updated={UPDATED}
      lead={
        <p>
          Why agents answer data questions more reliably through named metrics than through raw SQL, what to check
          before you connect one to your data, and how the main semantic layers expose their models to agents over MCP.
        </p>
      }
      primaryCta={{ href: '#checklist', label: 'What to look for', target: 'ai_agents_checklist' }}
      secondaryCta={{ href: '#options', label: 'Compare options', target: 'ai_agents_options' }}
      definition={{
        term: 'What is a semantic layer for AI agents?',
        body: (
          <>
            <p>
              It is the same semantic layer your dashboards use, exposed to an agent as tools. Instead of reading table
              schemas and writing SQL, the agent lists the metrics and dimensions you defined, reads their descriptions,
              and asks for one by name: revenue by country, by month. The layer writes the SQL, applies access rules and
              returns rows.
            </p>
            <p>
              Most agents connect through MCP, the Model Context Protocol. What matters is what the tools allow: query
              by name only, or also run any SQL; tenant set by the server, or chosen by the agent; bounded results, or
              whatever the agent asks for.
            </p>
          </>
        ),
      }}
      jsonLd={[spokeArticleJsonLd({ path: PATH, title: TITLE, description: DESCRIPTION, dateModified: UPDATED }), faqJsonLd(faqItems)]}
    >
      <HubSection
        eyebrow="The problem"
        title="Why raw text-to-SQL is fragile for agents"
        intro={
          <>
            <p>
              Give an agent database credentials and a list of tables, and every question becomes a guess. Which table
              holds orders? Does revenue include refunds? Which join reaches the customer&rsquo;s country? A human
              analyst learns the answers once. An agent works them out again in every conversation, and two
              conversations can reach different answers to the same question.
            </p>
            <p>
              In a product, the stakes are higher. If the agent serves your customers, every query must be limited to
              one customer&rsquo;s rows, and a prompt should never be able to change which customer that is. With raw
              SQL, that rule lives in the prompt. With a semantic layer, it lives in code the agent cannot edit.
            </p>
          </>
        }
      />

      <HubSection
        id="checklist"
        band
        eyebrow="What to look for"
        title="Five things to check before you connect an agent"
      >
        <HubTable
          caption="What to check in a semantic layer for AI agents"
          columns={['Check', 'Why it matters', 'What good looks like']}
          rows={checklistRows}
        />
      </HubSection>

      <HubSection
        id="how-it-works"
        eyebrow="An example"
        title="Named metrics as MCP tools"
        intro={
          <p>
            In hypequery, a dataset is a TypeScript or Python file in your application repo. The same definition serves
            your API and React hooks, and{' '}
            <Link href="/clickhouse-mcp" className={inlineLink}>
              @hypequery/mcp
            </Link>{' '}
            turns it into four tools. Nothing outside the published datasets is reachable.
          </p>
        }
      >
        <CodePair
          left={{ code: datasetCode, filename: 'analytics/datasets.ts' }}
          right={{ code: toolCallCode, filename: 'an agent tool call', language: 'javascript' }}
        />
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          <div className={marketing.card}>
            <h3 className="text-[17px] font-medium tracking-tight text-text">No SQL tool</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              The tools are <code className={inlineCode}>list_datasets</code>,{' '}
              <code className={inlineCode}>get_dataset_schema</code>, <code className={inlineCode}>query_metric</code>{' '}
              and <code className={inlineCode}>query_dataset</code>. Generated SQL can be returned for debugging, but
              the agent cannot send its own.
            </p>
          </div>
          <div className={marketing.card}>
            <h3 className="text-[17px] font-medium tracking-tight text-text">Tenant fails closed</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              A stdio server serves one tenant, set when it starts. Over HTTP, each caller&rsquo;s tenant comes from
              their verified credential. A tenant-keyed dataset with no trusted tenant refuses to start.
            </p>
          </div>
          <div className={marketing.card}>
            <h3 className="text-[17px] font-medium tracking-tight text-text">Bounded by default</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              Calls return 100 rows unless they ask for more, up to a ceiling you set (at most 10,000), with at most 50
              dimensions or measures per call. Queries run within one dataset; cross-dataset joins are not exposed to
              agents yet.
            </p>
          </div>
        </div>
      </HubSection>

      <HubSection
        id="options"
        band
        eyebrow="Options"
        title="How semantic layers expose metrics to agents"
        intro={
          <p>
            Checked against each vendor&rsquo;s own docs, repository or pricing page on {VERIFIED_ON}. &ldquo;Not
            covered&rdquo; means the sources we read did not say, not that the feature is missing.
          </p>
        }
      >
        <HubTable
          caption={`Semantic layers and their MCP servers, checked ${VERIFIED_ON}`}
          columns={['', 'How agents connect', 'Tools', 'Raw SQL', 'Access scoping', 'Databases', 'Licence or plan']}
          rows={optionsRows}
        />
        <p className="mt-4 text-sm leading-6 text-text-muted">
          For the models themselves, see the guides to{' '}
          <Link href="/semantic-layer/dbt-metricflow" className={inlineLink}>
            dbt MetricFlow
          </Link>
          ,{' '}
          <Link href="/semantic-layer/snowflake-semantic-views" className={inlineLink}>
            Snowflake semantic views
          </Link>{' '}
          and{' '}
          <Link href="/semantic-layer/databricks-metric-views" className={inlineLink}>
            Databricks metric views
          </Link>
          , and{' '}
          <Link href="/semantic-layer/open-source-tools" className={inlineLink}>
            open-source semantic layer tools
          </Link>{' '}
          compared.
        </p>
      </HubSection>

      <HubSection
        eyebrow="An honest answer"
        title="When another option fits better"
        intro={
          <>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                Your data is in Snowflake and the agent serves internal users: Snowflake semantic views and Cortex
                Analyst keep the model, the data and the permissions in one place.
              </li>
              <li>
                Your metrics already live in dbt on a supported warehouse: the dbt MCP server reuses them, with the
                Semantic Layer tools on a paid dbt plan. For a governed agent, switch off its SQL and CLI tools.
              </li>
              <li>
                One model must serve many databases and BI tools as well as agents: Cube covers more sources and more
                client APIs than a library inside one app.
              </li>
            </ul>
            <p>
              Use hypequery when the data is in ClickHouse and the agent is part of your product: the metric
              definitions, tenant rules and MCP server ship with the application that already knows who each user is.
            </p>
          </>
        }
      />

      <HubSection band eyebrow="Questions" title="Semantic layer for AI agents FAQ">
        <HubFaq items={faqItems} />
      </HubSection>

      <SemanticLayerGuides currentHref={PATH} />
      <HubSources checkedOn={VERIFIED_ON} sources={sources} />
      <SemanticLayerNextStep location="ai_agents_next_step" />
    </HubShell>
  );
}
