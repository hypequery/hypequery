import type { Metadata } from 'next';
import Link from 'next/link';
import CodeWindow from '@/components/CodeWindow';
import { HubFaq, HubLinkGrid, HubSection, HubShell, HubSources, HubTable } from '@/components/hub-page';
import { RelatedPages } from '@/components/related-pages';
import { SemanticLayerNextStep, inlineCode, inlineLink } from '@/components/semantic-layer-parts';
import { marketing } from '@/components/ui/marketing';
import { semanticLayerSpokes } from '@/data/semantic-layer-pages';
import { absoluteUrl, ogImage } from '@/lib/site';
import { faqJsonLd, type FaqItem } from '@/lib/structured-data';
import { updatedFor } from '@/data/page-dates';

const PATH = '/semantic-layer';
const TITLE = 'What Is a Semantic Layer? Definition, Examples, Tools';
const DESCRIPTION =
  'A semantic layer defines metrics, dimensions and joins once, so dashboards, APIs and AI agents get the same number. How it works, examples and tools.';
// The date every vendor fact on this page was checked against the vendor's own docs.
const VERIFIED_ON = 'November 10, 2026';

const DEFINITION =
  'A semantic layer is a shared definition of business metrics, dimensions and joins that sits between raw tables and the tools that query them. A dashboard, an API or an AI agent asks for "revenue by country", and the layer decides which column, aggregate, joins and filters that means, then writes the SQL. Every consumer gets the same number from the same definition.';

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl(PATH) },
  openGraph: {
    type: 'article',
    url: absoluteUrl(PATH),
    title: TITLE,
    description: DESCRIPTION,
    images: ogImage('What is a semantic layer?'),
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },
};

const vocabulary = [
  { term: 'Dimensions', copy: 'Attributes you group and filter by, such as status, country, plan or signup date.' },
  { term: 'Measures', copy: 'Aggregations bound to a column, such as SUM(amount) or COUNT(DISTINCT user_id).' },
  { term: 'Metrics', copy: 'Named business numbers built from measures, such as revenue, average order value or retention.' },
  { term: 'Entities and joins', copy: 'Which tables relate and how, so a query can group orders by customer country without hand-written joins.' },
  { term: 'Time grain', copy: 'The agreed time column for each table and the grains it rolls up to (day, week, month).' },
  { term: 'Governed filters', copy: 'Rules every query gets whether it asks or not, such as excluding test accounts or scoping to one tenant.' },
] as const;

const requestExample = `// What the caller sends: names, not SQL
{
  "measures": ["revenue"],
  "dimensions": ["customer.country"],
  "filters": [{ "field": "status", "operator": "eq", "value": "paid" }]
}`;

const compiledExample = `-- What a semantic layer writes for it (illustrative)
SELECT
  customer.country AS "customer.country",
  sum(orders.amount) AS revenue
FROM orders
LEFT ANY JOIN customers AS customer
  ON orders.customer_id = customer.id
WHERE orders.status = 'paid'
  AND orders.org_id = 'org_42'   -- tenant rule, always added
GROUP BY customer.country`;

// One metric (revenue by order status) written for four semantic layers. Each
// follows the syntax on that vendor's docs page, linked in Sources.
const dbtExample = `# models/orders.yml (dbt, latest metrics spec)
models:
  - name: orders
    semantic_model:
      enabled: true
    agg_time_dimension: ordered_at
    columns:
      - name: order_id
        entity:
          type: primary
          name: order
      - name: ordered_at
        granularity: day
        dimension:
          type: time
      - name: status
        dimension:
          type: categorical
    metrics:
      - name: revenue
        type: simple
        agg: sum
        expr: amount

# dbt sl query --metrics revenue --group-by order__status`;

const snowflakeExample = `-- Snowflake semantic view
CREATE SEMANTIC VIEW sales
  TABLES (
    orders AS analytics.public.orders PRIMARY KEY (order_id)
  )
  DIMENSIONS (
    orders.status AS orders.status
  )
  METRICS (
    orders.revenue AS SUM(orders.amount)
  );

SELECT status, AGG(revenue)
FROM sales
GROUP BY status;`;

const databricksExample = `-- Databricks metric view (Unity Catalog)
CREATE VIEW sales WITH METRICS LANGUAGE YAML AS
$$
version: 1.1
source: analytics.public.orders
fields:
  - name: status
    expr: status
measures:
  - name: revenue
    expr: SUM(amount)
$$;

SELECT status, MEASURE(revenue)
FROM sales
GROUP BY ALL;`;

const codeExample = `// datasets/orders.ts (hypequery, a semantic layer in code)
import { dataset, dimension, measure } from '@hypequery/datasets';

export const Orders = dataset('orders', {
  source: 'orders',
  timeKey: 'ordered_at',
  dimensions: {
    status: dimension.string(),
  },
  measures: {
    revenue: measure.sum('amount'),
  },
});

await analytics.execute(Orders, {
  dimensions: ['status'],
  measures: ['revenue'],
});`;

// Type-checked against @hypequery/datasets 0.32.0 on 2026-11-22.
const hypequeryModel = `import {
  belongsTo, dataset, dimension, divide, measure, nullIfZero,
} from '@hypequery/datasets';

export const Customers = dataset('customers', {
  source: 'customers',
  tenantKey: 'org_id',
  dimensions: {
    id: dimension.string(),
    country: dimension.string(),
    plan: dimension.string(),
  },
  measures: { customers: measure.countDistinct('id') },
});

export const Orders = dataset('orders', {
  source: 'orders',
  tenantKey: 'org_id', // every query is scoped to one tenant
  timeKey: 'created_at',
  dimensions: {
    status: dimension.string(),
    createdAt: dimension.timestamp({ column: 'created_at' }),
  },
  measures: {
    revenue: measure.sum('amount'),
    orders: measure.count('order_id'),
    averageOrderValue: measure.derived({
      uses: { revenue: 'revenue', orders: 'orders' },
      formula: ({ revenue, orders }) => divide(revenue, nullIfZero(orders)),
      label: 'Average order value',
    }),
  },
  relationships: {
    customer: belongsTo(() => Customers, { from: 'customer_id', to: 'id' }),
  },
});

// Revenue and average order value by customer country, for one tenant.
const result = await analytics.execute(
  Orders,
  { dimensions: ['customer.country'], measures: ['revenue', 'averageOrderValue'] },
  { runtime: { tenant: session.orgId } },
);`;

const shapes = [
  {
    name: 'Inside a BI tool',
    examples: 'LookML, Power BI semantic models, Tableau data sources',
    copy: 'Consistent inside that tool. Other tools, your application code and agents usually cannot reuse the definitions.',
  },
  {
    name: 'In the warehouse',
    examples: 'Snowflake semantic views, Databricks metric views',
    copy: 'Definitions are database objects with the warehouse’s permissions. Anything that speaks SQL to that warehouse can use them.',
  },
  {
    name: 'Next to your transformations',
    examples: 'dbt Semantic Layer (MetricFlow)',
    copy: 'Metrics sit in YAML beside the models that build the tables, and a query engine compiles requests to warehouse SQL.',
  },
  {
    name: 'A standalone service',
    examples: 'Cube, AtScale',
    copy: 'A separate server between the database and every consumer, with its own APIs, caching and access rules.',
  },
  {
    name: 'In application code',
    examples: 'hypequery datasets',
    copy: 'Definitions are TypeScript or Python in your app’s repo, imported by your backend and deployed with it.',
  },
] as const;

const neighbourRows = [
  [
    'Semantic layer',
    'Metrics, dimensions, joins and governed filters, plus a compiler that turns a request into SQL',
    'Dashboards, APIs, notebooks and AI agents that need the same numbers',
  ],
  [
    'Metrics layer',
    'The metric definitions on their own: revenue is SUM(amount) where status is paid',
    'The same consumers; most metrics layers grew into semantic layers once metrics needed joins',
  ],
  [
    'Data model',
    'The tables themselves: what dbt or your pipelines build, with keys and types',
    'Analysts and the semantic layer, which sits on top of it',
  ],
  [
    'Context layer',
    'Descriptions, glossary entries and example queries retrieved into an LLM prompt',
    'Text-to-SQL systems. It informs the model but does not compile or enforce anything',
  ],
  [
    'Data catalog',
    'An inventory of tables and columns with owners, lineage and documentation',
    'People finding data. It describes tables; it does not answer queries',
  ],
];

const optionRows = [
  [
    <Link key="dbt" href="/semantic-layer/dbt-metricflow" className={inlineLink}>
      dbt Semantic Layer (MetricFlow)
    </Link>,
    'YAML in the dbt project, next to the models',
    'GraphQL, JDBC (Arrow Flight SQL) and Python APIs; BI integrations; dbt MCP server',
    'Hosted: Snowflake, BigQuery, Databricks, Redshift, Postgres, Trino. MetricFlow has experimental, unreleased ClickHouse support',
    'MetricFlow: Apache 2.0. Hosted Semantic Layer: dbt platform, Starter ($100 per user per month) and up',
    'The warehouse credentials configured for the Semantic Layer',
  ],
  [
    <Link key="snowflake" href="/semantic-layer/snowflake-semantic-views" className={inlineLink}>
      Snowflake semantic views
    </Link>,
    'A schema object: SQL DDL, or YAML loaded with a system function',
    'SEMANTIC_VIEW() clause or plain SQL with AGG(); Cortex Analyst, Cortex Agents, managed MCP server',
    'Snowflake only',
    'No: a Snowflake feature. Imports and exports Apache Ossie YAML',
    'SELECT on the view; row access and masking policies on base tables propagate',
  ],
  [
    <Link key="databricks" href="/semantic-layer/databricks-metric-views" className={inlineLink}>
      Databricks metric views
    </Link>,
    'A Unity Catalog view defined in YAML',
    'SQL with MEASURE(); dashboards, Genie, BI tools through SQL',
    'Databricks; the core is in Apache Spark 4.2',
    'Core contributed to Apache Spark (Apache 2.0)',
    'Unity Catalog privileges; row filters and masks cannot be set on the view itself',
  ],
  [
    <Link key="cube" href="/compare/hypequery-vs-cube" className={inlineLink}>
      Cube
    </Link>,
    'A separate service with YAML or JavaScript data models',
    'REST, GraphQL and SQL APIs; embedding SDKs',
    'Most warehouses, including ClickHouse',
    'Cube Core: Apache 2.0. Cube Cloud: paid plans',
    'A security context from a signed JWT, applied through query rewrite and access rules',
  ],
  [
    <Link key="hypequery" href="/clickhouse-semantic-layer" className={inlineLink}>
      hypequery (code-defined)
    </Link>,
    'TypeScript or Python files in your application repo',
    'Function calls, a typed HTTP API, React hooks, an MCP server',
    'ClickHouse',
    'Apache 2.0',
    'A tenant key on each dataset, filled from the authenticated session; queries without it fail',
  ],
];

const formatRows = [
  ['Who edits it', 'Analysts and analytics engineers, often without a build step', 'Engineers, through the same pull requests as the app'],
  ['What catches a typo', 'A parse or compile step in the tool, at deploy or query time', 'The type checker, in the editor, for every caller'],
  ['Renaming a metric', 'Search and replace across YAML and every dashboard that references it', 'A refactor; callers that still use the old name fail to build'],
  ['Reuse and abstraction', 'Copy, anchors, or the tool’s own templating', 'Functions, imports and shared helpers'],
  ['Portability', 'Closer to Apache Ossie, which is also YAML', 'Tied to a runtime language, unless exported'],
  ['Where it runs', 'A separate engine or the warehouse', 'Inside your backend process'],
];

const buildSteps = [
  {
    title: 'Pick the five metrics people argue about',
    copy: 'Revenue, active users, churn, whatever gets questioned in meetings. Write each down in a sentence, including what is excluded. That sentence is the spec.',
  },
  {
    title: 'Decide where it lives',
    copy: 'In the warehouse if all consumers are BI tools on one warehouse; next to dbt if analysts own it; a service if many apps on many databases need it; in code if your product is the main consumer.',
  },
  {
    title: 'Model one table end to end',
    copy: 'Dimensions, measures, the time column and the join to its most-used neighbour. Resist modelling every column; unmodelled fields are fine.',
  },
  {
    title: 'Add the rules that must never be skipped',
    copy: 'Tenant scope, excluded test accounts, soft-deleted rows. Put them in the layer so that no query can leave one out.',
  },
  {
    title: 'Point one consumer at it',
    copy: 'Replace one dashboard query or one API endpoint, and compare the numbers with the old version before switching more.',
  },
  {
    title: 'Expose it to agents last',
    copy: 'Once humans trust the numbers, give agents the same metrics as tools. An agent is the consumer least able to tell you a number is wrong.',
  },
];

const faqItems: FaqItem[] = [
  {
    question: 'What is a semantic layer?',
    answer:
      'A semantic layer is a shared definition of business metrics, dimensions and joins that sits between raw tables and the tools that query them. Dashboards, APIs, notebooks and AI agents ask for "revenue" by name, and the layer turns that into the right SQL, so every consumer gets the same number.',
  },
  {
    question: 'What is an example of a semantic layer?',
    answer:
      'A metric called revenue defined once as SUM(amount) on the orders table, with status and customer country as dimensions. A dashboard asking for revenue by country and an AI agent asking the same question both go through that definition. dbt MetricFlow, Snowflake semantic views, Databricks metric views, Cube and hypequery datasets are all ways to write it.',
  },
  {
    question: 'How does a semantic layer work?',
    answer:
      'A caller sends names: measures, dimensions and filters. The layer looks up each definition, works out which tables and joins are needed, adds filters that must always apply, such as tenant scope, and compiles the request into SQL for the database. Many layers also cache results and generate API or tool schemas from the same definitions.',
  },
  {
    question: 'What is the difference between a semantic layer and a data warehouse?',
    answer:
      'The warehouse stores and computes the data. The semantic layer stores the meaning, including which column is revenue, how tables join and which filters always apply. Some warehouses now include one, such as Snowflake semantic views and Databricks metric views, but the two jobs are still separate.',
  },
  {
    question: 'Is a metrics layer the same as a semantic layer?',
    answer:
      'Mostly. "Metrics layer" usually means the metric definitions alone. "Semantic layer" also covers entities, joins and dimensions, which a metric needs before it can be sliced.',
  },
  {
    question: 'Do AI agents need a semantic layer?',
    answer:
      'For numbers you show to users, yes. An agent writing raw SQL has to guess which column means revenue and how tables join, can double count through a join, and can skip filters such as tenant scoping. A semantic layer gives it named metrics and enforces the filters. dbt, Snowflake, Databricks and hypequery all ship agent or MCP integrations for this reason.',
  },
  {
    question: 'What is a good semantic layer for ClickHouse?',
    answer:
      'Cube supports ClickHouse as a standalone service with its own APIs and caching. The dbt Semantic Layer does not run on ClickHouse today, because MetricFlow support is experimental and unreleased. hypequery datasets are ClickHouse-only and live as TypeScript or Python in your application repo, which suits a team that wants the metrics inside its own backend with no extra service to run.',
  },
  {
    question: 'Is there a TypeScript semantic layer?',
    answer:
      'Yes. Cube data models can be written in JavaScript, and hypequery datasets are TypeScript (or Python) modules that your backend imports, so measures and dimensions are type-checked against every caller.',
  },
  {
    question: 'Is there an open-source semantic layer?',
    answer:
      'Yes. MetricFlow, the engine behind the dbt Semantic Layer, is Apache 2.0. So are Cube Core and hypequery. Metric views are part of Apache Spark 4.2. The hosted dbt Semantic Layer and Snowflake semantic views are not open source.',
  },
  {
    question: 'What is Open Semantic Interchange (OSI)?',
    answer:
      'OSI is a vendor-neutral, Apache 2.0 spec for exchanging semantic models between tools, launched by Snowflake and partners in September 2025. It entered the Apache Incubator in 2026 and is now called Apache Ossie. It defines a file format, not a query engine.',
  },
];

const sources = [
  {
    vendor: 'dbt Labs',
    urls: [
      'https://docs.getdbt.com/docs/use-dbt-semantic-layer/dbt-sl',
      'https://docs.getdbt.com/docs/build/latest-metrics-spec',
      'https://docs.getdbt.com/docs/use-dbt-semantic-layer/sl-faqs',
      'https://www.getdbt.com/pricing',
      'https://github.com/dbt-labs/metricflow/pull/2124',
    ],
  },
  {
    vendor: 'Snowflake',
    urls: [
      'https://docs.snowflake.com/en/user-guide/views-semantic/overview',
      'https://docs.snowflake.com/en/user-guide/views-semantic/querying',
      'https://docs.snowflake.com/en/user-guide/views-semantic/best-practices-dev',
    ],
  },
  {
    vendor: 'Databricks',
    urls: [
      'https://docs.databricks.com/aws/en/uc-semantics/metric-views/',
      'https://docs.databricks.com/aws/en/uc-semantics/metric-views/query',
      'https://spark.apache.org/releases/spark-release-4-2-0.html',
    ],
  },
  {
    vendor: 'Apache Ossie (OSI)',
    urls: ['https://ossie.apache.org/updates/', 'https://github.com/apache/ossie'],
  },
  {
    vendor: 'Cube',
    urls: [
      'https://docs.cube.dev/docs/data-modeling/access-control/context',
      'https://cube.dev/pricing',
      'https://github.com/cube-js/cube',
    ],
  },
];

const articleJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'TechArticle',
  headline: TITLE,
  description: DESCRIPTION,
  url: absoluteUrl(PATH).toString(),
  dateModified: updatedFor(PATH),
  about: { '@id': absoluteUrl(`${PATH}#definition`).toString() },
  author: { '@type': 'Organization', name: 'hypequery' },
  publisher: { '@type': 'Organization', name: 'hypequery', url: absoluteUrl('/').toString() },
};

const definedTermJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'DefinedTerm',
  '@id': absoluteUrl(`${PATH}#definition`).toString(),
  name: 'Semantic layer',
  alternateName: ['Metrics layer', 'Semantic model'],
  description: DEFINITION,
  url: absoluteUrl(PATH).toString(),
};

const spokeLinks = semanticLayerSpokes.map((page) => ({ href: page.href, title: page.label, description: page.description }));

export default function SemanticLayerPage() {
  return (
    <HubShell
      path={PATH}
      breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'Semantic layer' }]}
      title="What is a semantic layer?"
      updated={updatedFor(PATH)}
      lead={
        <p>
          A semantic layer defines your metrics once so every dashboard, API and AI agent returns the same number. This
          guide covers how one works, why agents need one more than people do, where one can live, and how dbt
          MetricFlow, Snowflake, Databricks, Cube and a semantic layer written in code compare.
        </p>
      }
      primaryCta={{ href: '#how-it-works', label: 'How it works', target: 'semantic_layer_how' }}
      secondaryCta={{ href: '#options', label: 'Compare options', target: 'semantic_layer_options' }}
      definition={{
        term: 'What is a semantic layer?',
        body: (
          <>
            <p>{DEFINITION.replace('"revenue by country"', '“revenue by country”')}</p>
            <p>
              Without one, every dashboard defines revenue again and the numbers drift apart. With one, a metric changes
              in a single place and every consumer picks it up, and a filter that must always apply, such as one
              customer&rsquo;s data only, cannot be skipped.
            </p>
          </>
        ),
      }}
      jsonLd={[articleJsonLd, definedTermJsonLd, faqJsonLd(faqItems)]}
    >
      <HubSection
        id="guides"
        eyebrow="In this section"
        title="Semantic layer guides"
        intro={
          <p>
            This page is the overview. Each guide below goes deep on one tool or one question, with its own sources.
            Start with the one that matches the stack you already run.
          </p>
        }
      >
        <HubLinkGrid links={spokeLinks} />
      </HubSection>

      <HubSection band eyebrow="The parts" title="What every semantic layer defines">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {vocabulary.map((item) => (
            <div key={item.term} className="rounded-xl border border-border bg-bg-card p-5">
              <dt className="text-sm font-semibold text-text">{item.term}</dt>
              <dd className="mt-2 text-[13px] leading-5 text-text-muted">{item.copy}</dd>
            </div>
          ))}
        </dl>
      </HubSection>

      <HubSection
        id="how-it-works"
        eyebrow="Architecture"
        title="How a semantic layer works"
        intro={
          <>
            <p>
              Every semantic layer, whatever its syntax, does the same five things between a request and the database:
            </p>
            <ol className="list-decimal space-y-2 pl-5">
              <li>
                <strong className="text-text">Validate the request.</strong> The caller names measures, dimensions and
                filters. Anything not defined is rejected before a query exists.
              </li>
              <li>
                <strong className="text-text">Resolve definitions.</strong> <code className={inlineCode}>revenue</code>{' '}
                becomes <code className={inlineCode}>sum(orders.amount)</code>; a derived metric becomes its formula over
                other measures.
              </li>
              <li>
                <strong className="text-text">Plan joins.</strong> A dimension on another table means a join, and the
                layer knows the keys and the cardinality, so it can refuse a join that would double count.
              </li>
              <li>
                <strong className="text-text">Apply governed filters.</strong> Tenant scope, row-level rules and
                standing exclusions are added whether the caller asked or not.
              </li>
              <li>
                <strong className="text-text">Compile and run.</strong> The result is SQL in the database&rsquo;s
                dialect. Many layers cache the result under a key that includes the tenant.
              </li>
            </ol>
            <p>
              The request is data and the SQL is an output. That split is what lets the same definition serve a
              dashboard, an HTTP endpoint and an agent tool: each one sends the request shape on the left and never
              sees the SQL on the right.
            </p>
          </>
        }
      >
        <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
          <CodeWindow code={requestExample} filename="request.json" language="json" />
          <CodeWindow code={compiledExample} filename="compiled.sql" language="sql" />
        </div>
      </HubSection>

      <HubSection
        band
        eyebrow="Neighbours"
        title="Semantic layer vs metrics layer, data model and context layer"
        intro={
          <p>
            These terms get used interchangeably and they are not the same job. The short version: the data model is the
            tables, the semantic layer is the meaning on top, and a context layer is what you feed a model when you have
            no semantic layer.
          </p>
        }
      >
        <HubTable
          caption="Semantic layer compared with neighbouring concepts"
          columns={['Term', 'What it holds', 'Who uses it']}
          rows={neighbourRows}
        />
      </HubSection>

      <HubSection
        id="example"
        eyebrow="Example"
        title="One metric, four semantic layers"
        intro={
          <>
            <p>
              The same definition, revenue as <code className={inlineCode}>SUM(amount)</code> on an orders table,
              grouped by order status, in four tools, each with the query that reads it back. The vocabulary barely
              changes. What changes is where the definition lives, what can query it, and who controls access.
            </p>
            <p>
              The first three each have a full guide:{' '}
              <Link href="/semantic-layer/dbt-metricflow" className={inlineLink}>
                the dbt Semantic Layer and MetricFlow
              </Link>
              ,{' '}
              <Link href="/semantic-layer/snowflake-semantic-views" className={inlineLink}>
                Snowflake semantic views
              </Link>{' '}
              and{' '}
              <Link href="/semantic-layer/databricks-metric-views" className={inlineLink}>
                Databricks metric views
              </Link>
              .
            </p>
          </>
        }
      >
        <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
          <CodeWindow code={dbtExample} filename="dbt MetricFlow" language="yaml" />
          <CodeWindow code={snowflakeExample} filename="Snowflake semantic view" language="sql" />
          <CodeWindow code={databricksExample} filename="Databricks metric view" language="sql" />
          <CodeWindow code={codeExample} filename="hypequery dataset" />
        </div>
      </HubSection>

      <HubSection
        id="ai-agents"
        band
        eyebrow="AI agents"
        title="Why AI agents need stable metric definitions, not raw text-to-SQL"
        intro={
          <>
            <p>
              Give a language model your schema and ask for last month&rsquo;s revenue, and it will write plausible SQL.
              Plausible is the problem. A person who gets a strange number from a dashboard asks a colleague; a customer
              who gets one from an in-product assistant files a ticket or, worse, believes it. The failures are
              predictable:
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong className="text-text">The wrong column.</strong> <code className={inlineCode}>amount</code>,{' '}
                <code className={inlineCode}>total</code> and <code className={inlineCode}>net_amount</code> all look like
                revenue. The model picks one, and next week it may pick another.
              </li>
              <li>
                <strong className="text-text">Double counting through joins.</strong> Joining orders to line items and
                summing the order amount inflates revenue by the number of items per order. The SQL runs and the number
                is wrong.
              </li>
              <li>
                <strong className="text-text">Missing standing filters.</strong> Test accounts, refunds, soft-deleted
                rows. Nobody wrote them in the prompt, so they are not in the query.
              </li>
              <li>
                <strong className="text-text">Missing tenant scope.</strong> In a multi-tenant product, a query without
                the tenant predicate is a data leak. Prompt instructions to add it are a request; they are not
                enforcement.
              </li>
              <li>
                <strong className="text-text">Different answers to the same question.</strong> Generated SQL varies with
                wording and sampling, so the same question asked twice can produce two queries.
              </li>
              <li>
                <strong className="text-text">Unbounded cost.</strong> A model can write a full scan over a billion rows
                as easily as an indexed lookup.
              </li>
            </ul>
            <p>
              A semantic layer changes the agent&rsquo;s job from writing SQL to choosing from a menu. Its tools take
              measure and dimension names as enums, so an invalid name fails validation and the model can retry. The
              joins, filters, tenant predicate and row limits come from the definitions, and the same request always
              compiles to the same SQL. You can test that once, in CI, instead of hoping each generated query is right.
            </p>
            <p>
              The tradeoff is coverage: an agent can only answer what you have modelled. For questions shown to
              customers we think that is the right default, and a{' '}
              <Link href="/blog/text-to-sql-vs-semantic-layer" className={inlineLink}>
                longer comparison of text-to-SQL and a semantic layer
              </Link>{' '}
              covers when raw SQL access still makes sense. The{' '}
              <Link href="/semantic-layer/ai-agents" className={inlineLink}>
                semantic layer for AI agents
              </Link>{' '}
              guide has the checklist, and{' '}
              <Link href="/semantic-layer/analytics-mcp-server" className={inlineLink}>
                analytics MCP servers
              </Link>{' '}
              compares servers that run SQL with servers that query named metrics.
            </p>
          </>
        }
      />

      <HubSection
        eyebrow="Where it lives"
        title="Five places a semantic layer can live"
        intro={
          <p>
            Where the definitions live matters more than the syntax. The location decides which tools can reuse them,
            whose permissions apply, and what you have to run.
          </p>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {shapes.map((shape) => (
            <div key={shape.name} className="rounded-xl border border-border bg-bg-card p-5">
              <h3 className="text-sm font-semibold text-text">{shape.name}</h3>
              <p className="mt-1 font-mono text-[11px] leading-4 text-text-dim">{shape.examples}</p>
              <p className="mt-3 text-[13px] leading-5 text-text-muted">{shape.copy}</p>
            </div>
          ))}
        </div>
      </HubSection>

      <HubSection
        id="options"
        band
        eyebrow="Comparison"
        title="Semantic layer tools compared: Cube, dbt, Snowflake, Databricks and code"
        intro={
          <>
            <p>
              Each cell was checked against the vendor&rsquo;s own docs on {VERIFIED_ON}. These products changed a lot
              in 2026, so check the linked sources before you decide. hypequery is listed last because it is ours.
            </p>
            <p>
              For a licence-by-licence view, see{' '}
              <Link href="/semantic-layer/open-source-tools" className={inlineLink}>
                open-source semantic layer tools
              </Link>
              ; if you are on dbt and want out, see{' '}
              <Link href="/semantic-layer/dbt-semantic-layer-alternatives" className={inlineLink}>
                dbt Semantic Layer alternatives
              </Link>
              ; for Cube, see{' '}
              <Link href="/cube-js-alternative" className={inlineLink}>
                Cube alternatives
              </Link>
              .
            </p>
          </>
        }
      >
        <HubTable
          caption={`Semantic layer options compared, checked ${VERIFIED_ON}`}
          columns={['Option', 'Where definitions live', 'How you query it', 'Databases', 'Open source and price', 'Access control']}
          rows={optionRows}
        />
      </HubSection>

      <HubSection
        id="code-vs-yaml"
        eyebrow="Formats"
        title="Code-first vs YAML semantic layers"
        intro={
          <>
            <p>
              Most semantic layers are YAML: dbt, Databricks metric views, Cube&rsquo;s YAML models and the Ossie
              interchange format. A few are code, either as an option (Cube&rsquo;s JavaScript models) or as the only
              format (hypequery&rsquo;s TypeScript and Python datasets). The format follows from who maintains the layer.
            </p>
            <p>
              YAML suits analytics engineers working next to dbt models, and tools that generate or exchange
              definitions. Code suits product engineers whose application is the main consumer, because the definitions
              get the same tooling as the rest of the app: types, refactors, tests and review.
            </p>
          </>
        }
      >
        <HubTable
          caption="YAML and code-first semantic layers compared"
          columns={['', 'YAML (dbt, Databricks, Cube YAML models)', 'Code (hypequery, Cube JavaScript models)']}
          rows={formatRows}
        />
      </HubSection>

      <HubSection
        id="hypequery"
        band
        eyebrow="In code"
        title="How hypequery datasets form a semantic layer"
        intro={
          <>
            <p>
              hypequery is our open-source semantic layer for ClickHouse, written in TypeScript or Python (beta). Each
              table is a <code className={inlineCode}>dataset</code> with dimensions,{' '}
              <Link href="/docs/datasets/measures" className={inlineLink}>
                measures
              </Link>{' '}
              (including derived measures built from other measures) and{' '}
              <Link href="/docs/datasets/relationships" className={inlineLink}>
                relationships
              </Link>{' '}
              to other datasets. A <code className={inlineCode}>tenantKey</code> makes the dataset fail closed: a query
              without trusted tenant context throws, and callers cannot filter on the tenant column themselves.
            </p>
            <p>
              Relationships are where it earns the name. A <code className={inlineCode}>belongsTo</code> lets callers
              group orders by <code className={inlineCode}>customer.country</code> without writing a join. It compiles
              to a ClickHouse <code className={inlineCode}>LEFT ANY JOIN</code>, so a duplicate customer key cannot
              inflate revenue; to-many relationships stay metadata only, and duplicate-sensitive aggregates through a
              to-one join are rejected. That is the double-counting failure from the agents section, ruled out by the
              definition.
            </p>
            <p>
              The same datasets serve HTTP endpoints with OpenAPI, typed React hooks, and MCP tools generated from the
              catalog, with results cached under keys that include the tenant. The{' '}
              <Link href="/clickhouse-semantic-layer" className={inlineLink}>
                ClickHouse semantic layer
              </Link>{' '}
              page covers the TypeScript side, and the{' '}
              <Link href="/python-semantic-layer" className={inlineLink}>
                Python semantic layer
              </Link>{' '}
              page covers FastAPI, Django and notebooks.
            </p>
          </>
        }
      >
        <div className="max-w-[860px]">
          <CodeWindow code={hypequeryModel} filename="analytics/datasets.ts" />
        </div>
      </HubSection>

      <HubSection
        eyebrow="Interchange"
        title="Open Semantic Interchange, now Apache Ossie"
        intro={
          <>
            <p>
              Every option above stores definitions in its own format, which locks metrics into one tool. Open Semantic
              Interchange (OSI) is a vendor-neutral YAML or JSON format for semantic models, so one definition can move
              between tools. Snowflake launched it with partners in September 2025, the first spec was published under
              Apache 2.0 in January 2026, and it entered the Apache Incubator under the name Apache Ossie.
            </p>
            <p>
              Snowflake semantic views already import and export Ossie YAML, dbt v1.12 reads Ossie files, and a
              separate converters repository covers dbt, Databricks, Power BI and others. Ossie describes
              models and does not run queries. The{' '}
              <Link href="/semantic-layer/open-semantic-interchange" className={inlineLink}>
                Open Semantic Interchange guide
              </Link>{' '}
              covers the spec, its members and what is still missing.
            </p>
          </>
        }
      />

      <HubSection
        id="build"
        band
        eyebrow="Getting started"
        title="How to build a semantic layer"
        intro={
          <p>
            The tool matters less than the order you do things in. Teams that model every table before shipping anything
            tend to stall; teams that model the contested metrics first get value in a week.
          </p>
        }
      >
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {buildSteps.map((step, index) => (
            <li key={step.title} className="rounded-xl border border-border bg-bg-card p-5">
              <p className="font-mono text-xs text-text-dim">Step {index + 1}</p>
              <h3 className="mt-1 text-sm font-semibold text-text">{step.title}</h3>
              <p className="mt-2 text-[13px] leading-5 text-text-muted">{step.copy}</p>
            </li>
          ))}
        </ol>
      </HubSection>

      <HubSection
        eyebrow="Choosing"
        title="How to choose a semantic layer"
        intro={
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong className="text-text">All your data is in Snowflake or Databricks</strong>, and the consumers are BI
              tools and the warehouse&rsquo;s own AI features. Start with{' '}
              <Link href="/semantic-layer/snowflake-semantic-views" className={inlineLink}>
                Snowflake semantic views
              </Link>{' '}
              or{' '}
              <Link href="/semantic-layer/databricks-metric-views" className={inlineLink}>
                Databricks metric views
              </Link>
              . Neither needs anything extra to run.
            </li>
            <li>
              <strong className="text-text">You already model in dbt</strong> and want one set of metrics across several
              BI tools. The{' '}
              <Link href="/semantic-layer/dbt-metricflow" className={inlineLink}>
                dbt Semantic Layer
              </Link>{' '}
              keeps them next to your models.
            </li>
            <li>
              <strong className="text-text">You need a serving layer with caching</strong> and APIs in front of any
              warehouse. Use a standalone service such as Cube. Serving the layer over APIs to front ends you build is
              what vendors call{' '}
              <Link href="/semantic-layer/headless-bi" className={inlineLink}>
                headless BI
              </Link>
              .
            </li>
            <li>
              <strong className="text-text">The metrics power your own product</strong>, behind your API, in
              customer-facing dashboards and in an in-product agent, with one customer&rsquo;s data per request. Define
              them in code, where your backend already authenticates users, and check the{' '}
              <Link href="/semantic-layer/access-control" className={inlineLink}>
                access control
              </Link>{' '}
              test list before launch. On ClickHouse, that is what{' '}
              <Link href="/clickhouse-semantic-layer" className={inlineLink}>
                hypequery datasets
              </Link>{' '}
              do; for the product side, see{' '}
              <Link href="/embedded-analytics" className={inlineLink}>
                embedded analytics
              </Link>
              .
            </li>
          </ul>
        }
      />

      <HubSection band eyebrow="Questions" title="Semantic layer FAQ">
        <HubFaq items={faqItems} />
      </HubSection>

      <RelatedPages
        title="Semantic layers on ClickHouse, and the docs"
        pages={[
          {
            href: '/clickhouse-semantic-layer',
            title: 'ClickHouse semantic layer',
            description: 'Datasets, measures and tenant keys for ClickHouse in TypeScript or Python.',
          },
          {
            href: '/python-semantic-layer',
            title: 'Python semantic layer',
            description: 'Datasets served from FastAPI, Django or Flask, and queried from notebooks.',
          },
          {
            href: '/compare/hypequery-vs-cube',
            title: 'hypequery vs Cube',
            description: 'A code-first library compared with a standalone semantic layer service.',
          },
          {
            href: '/clickhouse-saas-analytics',
            title: 'ClickHouse embedded analytics',
            description: 'Tenant isolation, query limits and caching for customer-facing analytics on ClickHouse.',
          },
          {
            href: '/compare',
            title: 'All comparisons',
            description: 'hypequery against Cube, Metabase, Luzmo, Embeddable, QueryPanel and the ClickHouse clients.',
          },
          {
            href: '/blog/text-to-sql-vs-semantic-layer',
            title: 'Text-to-SQL vs a semantic layer',
            description: 'When an agent should write SQL and when it should query named metrics.',
          },
        ]}
      />

      <div className={marketing.container}>
        <div className="border-t border-border pt-12" />
      </div>
      <HubSources checkedOn={VERIFIED_ON} sources={sources} />
      <SemanticLayerNextStep location="semantic_layer_hub_next_step" />
    </HubShell>
  );
}
