import type { Metadata } from 'next';
import Link from 'next/link';
import CodeWindow from '@/components/CodeWindow';
import { HubFaq, HubLinkGrid, HubSection, HubShell, HubSources, HubTable } from '@/components/hub-page';
import { SemanticLayerNextStep, inlineCode, inlineLink } from '@/components/semantic-layer-parts';
import { marketing } from '@/components/ui/marketing';
import { semanticLayerSpokes } from '@/data/semantic-layer-pages';
import { absoluteUrl, ogImage } from '@/lib/site';
import { faqJsonLd, type FaqItem } from '@/lib/structured-data';

const PATH = '/semantic-layer';
const TITLE = 'What Is a Semantic Layer? Examples and Options Compared';
const DESCRIPTION =
  'A semantic layer defines metrics, dimensions and joins once, so every dashboard, API and AI agent gets the same number. Examples, plus dbt MetricFlow, Snowflake, Databricks, Cube and OSI compared.';
// The date every vendor fact on this page was checked against the vendor's own docs.
const VERIFIED_ON = 'November 10, 2026';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl(PATH) },
  openGraph: {
    type: 'website',
    url: absoluteUrl(PATH),
    title: `${TITLE} | hypequery`,
    description: DESCRIPTION,
    images: ogImage(TITLE),
  },
  twitter: {
    card: 'summary_large_image',
    title: `${TITLE} | hypequery`,
    description: DESCRIPTION,
  },
};

const vocabulary = [
  { term: 'Dimensions', copy: 'Attributes you group and filter by: status, country, plan, signup date.' },
  { term: 'Measures', copy: 'Aggregations bound to a column, such as SUM(amount) or COUNT(DISTINCT user_id).' },
  { term: 'Metrics', copy: 'Named business numbers built from measures: revenue, average order value, retention.' },
  { term: 'Entities and joins', copy: 'Which tables relate and how, so a query can group orders by customer country without hand-written joins.' },
  { term: 'Time grain', copy: 'The agreed time column for each table and the grains it rolls up to: day, week, month.' },
  { term: 'Governed filters', copy: 'Rules every query gets whether it asks or not, such as excluding test accounts or scoping to one tenant.' },
] as const;

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

const optionRows = [
  [
    'dbt Semantic Layer (MetricFlow)',
    'YAML in the dbt project, next to the models',
    'GraphQL, JDBC (Arrow Flight SQL) and Python APIs; BI integrations; dbt MCP server',
    'Hosted: Snowflake, BigQuery, Databricks, Redshift, Postgres, Trino. MetricFlow has experimental, unreleased ClickHouse support',
    'MetricFlow: Apache 2.0. Hosted Semantic Layer: dbt platform, Starter ($100 per user per month) and up',
    'The warehouse credentials configured for the Semantic Layer',
  ],
  [
    'Snowflake semantic views',
    'A schema object: SQL DDL, or YAML loaded with a system function',
    'SEMANTIC_VIEW() clause or plain SQL with AGG(); Cortex Analyst, Cortex Agents, managed MCP server',
    'Snowflake only',
    'No: a Snowflake feature. Imports and exports Apache Ossie YAML',
    'SELECT on the view; row access and masking policies on base tables propagate',
  ],
  [
    'Databricks metric views',
    'A Unity Catalog view defined in YAML',
    'SQL with MEASURE(); dashboards, Genie, BI tools through SQL',
    'Databricks; the core is in Apache Spark 4.2',
    'Core contributed to Apache Spark (Apache 2.0)',
    'Unity Catalog privileges; row filters and masks cannot be set on the view itself',
  ],
  [
    'Cube',
    'A separate service with YAML or JavaScript data models',
    'REST, GraphQL and SQL APIs; embedding SDKs',
    'Most warehouses, including ClickHouse',
    'Cube Core: Apache 2.0. Cube Cloud: paid plans',
    'A security context from a signed JWT, applied through query rewrite and access rules',
  ],
  [
    'hypequery (code-defined)',
    'TypeScript or Python files in your application repo',
    'Function calls, a typed HTTP API, React hooks, an MCP server',
    'ClickHouse',
    'Apache 2.0',
    'A tenant key on each dataset, filled from the authenticated session; queries without it fail',
  ],
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
    question: 'What is the difference between a semantic layer and a data warehouse?',
    answer:
      'The warehouse stores and computes the data. The semantic layer stores the meaning: which column is revenue, how tables join, which filters always apply. Some warehouses now include one, such as Snowflake semantic views and Databricks metric views, but the two jobs are still separate.',
  },
  {
    question: 'Is a metrics layer the same as a semantic layer?',
    answer:
      'Mostly. "Metrics layer" usually means the metric definitions alone. "Semantic layer" also covers entities, joins and dimensions, which a metric needs before it can be sliced.',
  },
  {
    question: 'Do AI agents need a semantic layer?',
    answer:
      'They benefit from one. An agent writing raw SQL has to guess which column means revenue and how tables join, and it can skip filters such as tenant scoping. A semantic layer gives it named metrics and enforces the filters. dbt, Snowflake, Databricks and hypequery all ship agent or MCP integrations for this reason.',
  },
  {
    question: 'What is Open Semantic Interchange (OSI)?',
    answer:
      'OSI is a vendor-neutral, Apache 2.0 spec for exchanging semantic models between tools, launched by Snowflake and partners in September 2025. It entered the Apache Incubator in 2026 and is now called Apache Ossie. It defines a file format, not a query engine.',
  },
  {
    question: 'Is there an open-source semantic layer?',
    answer:
      'Yes. MetricFlow, the engine behind the dbt Semantic Layer, is Apache 2.0. So are Cube Core and hypequery. Metric views are part of Apache Spark 4.2. The hosted dbt Semantic Layer and Snowflake semantic views are not open source.',
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
  dateModified: '2026-11-10',
  author: { '@type': 'Organization', name: 'hypequery' },
  publisher: { '@type': 'Organization', name: 'hypequery', url: absoluteUrl('/').toString() },
};

const spokeLinks = semanticLayerSpokes.map((page) => ({ href: page.href, title: page.label, description: page.description }));

export default function SemanticLayerPage() {
  return (
    <HubShell
      path={PATH}
      breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'Semantic layer' }]}
      title="What is a semantic layer?"
      lead={
        <p>
          What a semantic layer does, the parts every one shares, the five places one can live, and how dbt MetricFlow,
          Snowflake semantic views, Databricks metric views, Cube and a layer defined in code compare today.
        </p>
      }
      primaryCta={{ href: '#example', label: 'See an example', target: 'semantic_layer_example' }}
      secondaryCta={{ href: '#options', label: 'Compare options', target: 'semantic_layer_options' }}
      definition={{
        term: 'What is a semantic layer?',
        body: (
          <>
            <p>
              A semantic layer is a shared definition of your business metrics, dimensions and joins that sits between
              raw tables and everything that queries them. A dashboard, an API or an AI agent asks for
              &ldquo;revenue by country&rdquo;, and the layer decides which column, aggregate, joins and filters that
              means, then writes the SQL.
            </p>
            <p>
              Without one, each dashboard and query defines revenue again, and the numbers drift apart. With one, a
              metric changes in one place and every consumer picks up the change, and a filter that must always apply,
              such as one customer&rsquo;s data only, cannot be skipped.
            </p>
          </>
        ),
      }}
      jsonLd={[articleJsonLd, faqJsonLd(faqItems)]}
    >
      <HubSection eyebrow="The parts" title="What every semantic layer defines">
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
        id="example"
        band
        eyebrow="Example"
        title="One metric, four semantic layers"
        intro={
          <>
            <p>
              The same definition, revenue as <code className={inlineCode}>SUM(amount)</code> on an orders table,
              grouped by order status, in four tools, each with the query that reads it back. The vocabulary barely
              changes. What changes is where the definition lives, what can query it, and who controls access.
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
        eyebrow="Where it lives"
        title="Five places a semantic layer can live"
        intro={
          <p>
            The choice that matters most is not the syntax but the location. It decides which tools can reuse the
            definitions, whose permissions apply, and what you have to run.
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
        title="Semantic layer options compared"
        intro={
          <p>
            Each cell was checked against the vendor&rsquo;s own docs on {VERIFIED_ON}. These products changed a lot in
            2026, so check the linked sources before you decide. hypequery is listed last because it is ours.
          </p>
        }
      >
        <HubTable
          caption={`Semantic layer options compared, checked ${VERIFIED_ON}`}
          columns={['Option', 'Where definitions live', 'How you query it', 'Databases', 'Open source and price', 'Access control']}
          rows={optionRows}
        />
        <div className="mt-8">
          <HubLinkGrid links={spokeLinks} columns={2} />
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
              separate converters repository covers dbt, Databricks, Power BI and others. Ossie describes models; it is
              not a query engine. The{' '}
              <Link href="/semantic-layer/open-semantic-interchange" className={inlineLink}>
                Open Semantic Interchange guide
              </Link>{' '}
              covers the spec, its members and what is still missing.
            </p>
          </>
        }
      />

      <HubSection
        band
        eyebrow="Choosing"
        title="How to choose a semantic layer"
        intro={
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong className="text-text">All your data is in Snowflake or Databricks</strong> and the consumers are BI
              tools and the warehouse&rsquo;s own AI features: start with{' '}
              <Link href="/semantic-layer/snowflake-semantic-views" className={inlineLink}>
                semantic views
              </Link>{' '}
              or{' '}
              <Link href="/semantic-layer/databricks-metric-views" className={inlineLink}>
                metric views
              </Link>
              . There is nothing extra to run.
            </li>
            <li>
              <strong className="text-text">You already model in dbt</strong> and want one set of metrics across several
              BI tools: the{' '}
              <Link href="/semantic-layer/dbt-metricflow" className={inlineLink}>
                dbt Semantic Layer
              </Link>{' '}
              keeps them next to your models.
            </li>
            <li>
              <strong className="text-text">You need a serving layer with caching</strong> and APIs in front of any
              warehouse: a standalone service such as Cube.
            </li>
            <li>
              <strong className="text-text">The metrics power your own product</strong>, behind your API and in
              customer-facing dashboards, with one customer&rsquo;s data per request: define them in code, where your
              backend already authenticates users. On ClickHouse, that is what{' '}
              <Link href="/clickhouse-semantic-layer" className={inlineLink}>
                hypequery datasets
              </Link>{' '}
              do.
            </li>
          </ul>
        }
      />

      <HubSection eyebrow="Questions" title="Semantic layer FAQ">
        <HubFaq items={faqItems} />
      </HubSection>

      <HubSection
        band
        eyebrow="Guides"
        title="Semantic layer guides"
        intro={
          <p>
            Each guide explains one option and maps it onto a semantic layer defined in code. For the ClickHouse side,
            see the{' '}
            <Link href="/clickhouse-semantic-layer" className={inlineLink}>
              ClickHouse semantic layer
            </Link>
            .
          </p>
        }
      >
        <HubLinkGrid
          links={[
            ...spokeLinks,
            {
              href: '/clickhouse-semantic-layer',
              title: 'ClickHouse semantic layer',
              description: 'Datasets, measures and tenant keys for ClickHouse in TypeScript or Python.',
            },
            {
              href: '/compare/hypequery-vs-cube',
              title: 'hypequery vs Cube',
              description: 'A code-first library compared with a standalone semantic layer service.',
            },
          ]}
        />
      </HubSection>

      <div className={marketing.container}>
        <div className="border-t border-border pt-12" />
      </div>
      <HubSources checkedOn={VERIFIED_ON} sources={sources} />
      <SemanticLayerNextStep location="semantic_layer_hub_next_step" />
    </HubShell>
  );
}
