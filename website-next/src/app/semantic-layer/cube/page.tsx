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

const PATH = '/semantic-layer/cube';
const TITLE = 'Cube Semantic Layer: How It Works, With Examples (2026)';
const DESCRIPTION =
  'How the Cube semantic layer works: cubes, views, measures and joins in YAML, the REST, GraphQL and SQL APIs, pre-aggregations and access control, with examples.';
const VERIFIED_ON = 'November 26, 2026';

export const metadata = spokeMetadata({ path: PATH, title: TITLE, description: DESCRIPTION });

const cubeModel = `# model/cubes/orders.yml
cubes:
  - name: orders
    sql_table: orders

    joins:
      - name: customers
        sql: "{CUBE}.customer_id = {customers.customer_id}"
        relationship: many_to_one

    dimensions:
      - name: order_id
        sql: order_id
        type: number
        primary_key: true
      - name: status
        sql: status
        type: string
      - name: ordered_at
        sql: ordered_at
        type: time

    measures:
      - name: revenue
        sql: amount
        type: sum
      - name: count
        type: count
      - name: average_order_value
        sql: "{revenue} / NULLIF({count}, 0)"
        type: number

# model/views/sales.yml
views:
  - name: sales
    cubes:
      - join_path: orders
        includes: [status, ordered_at, revenue, count, average_order_value]
      - join_path: orders.customers
        prefix: true
        includes: [country]`;

const cubeQuery = `# REST (JSON) API, as an embedded dashboard would call it
curl "$CUBE_URL/cubejs-api/v1/load" \\
  -H "Authorization: Bearer $TOKEN" \\
  -G --data-urlencode 'query={
    "measures": ["sales.revenue", "sales.average_order_value"],
    "dimensions": ["sales.customers_country"],
    "timeDimensions": [
      { "dimension": "sales.ordered_at", "granularity": "month" }
    ]
  }'

-- SQL API (Postgres wire protocol), as a BI tool would
SELECT
  DATE_TRUNC('month', ordered_at) AS month,
  customers_country,
  MEASURE(revenue)
FROM sales
GROUP BY 1, 2;`;

const codeModel = `// datasets/orders.ts
import { belongsTo, dataset, dimension, divide, measure, nullIfZero } from '@hypequery/datasets';

const Customers = dataset('customers', {
  source: 'customers',
  tenantKey: 'tenant_id',
  dimensions: {
    id: dimension.string({ column: 'customer_id' }),
    country: dimension.string(),
  },
});

export const Orders = dataset('orders', {
  source: 'orders',
  tenantKey: 'tenant_id',
  timeKey: 'ordered_at',
  dimensions: {
    status: dimension.string(),
    orderedAt: dimension.timestamp({ column: 'ordered_at' }),
  },
  measures: {
    revenue: measure.sum('amount'),
    orderCount: measure.count('order_id'),
    averageOrderValue: measure.derived({
      uses: { revenue: 'revenue', orders: 'orderCount' },
      formula: ({ revenue, orders }) => divide(revenue, nullIfZero(orders)),
    }),
  },
  relationships: {
    customer: belongsTo(() => Customers, { from: 'customer_id', to: 'customer_id' }),
  },
});`;

const codeQuery = `// In your backend, with the tenant from the session
const result = await analytics.execute(
  Orders,
  {
    by: 'month',
    dimensions: ['customer.country'],
    measures: ['revenue', 'averageOrderValue'],
  },
  { runtime: { tenant: { id: session.orgId } } },
);

// The same dataset over HTTP, from React, or to agents over MCP
export const api = serve({
  queryBuilder: db,
  datasets: { orders: Orders },
});`;

const mappingRows = [
  ['Cube (`sql_table`)', 'Dataset (`source`)', 'One per table.'],
  ['`joins` with `relationship: many_to_one`', '`belongsTo`, `hasOne`', 'To-one joins, one hop deep. Cube also models one-to-many and many-to-many through a junction cube.'],
  ['Dimensions (`string`, `number`, `time`)', '`dimension.string()`, `dimension.timestamp()`, `timeKey`', 'Grains come from `by`, as Cube’s come from `granularity`.'],
  ['Measures (`sum`, `count`, `avg`, `count_distinct`)', '`measure.sum()`, `measure.count()` and friends', 'TypeScript checks measure names in queries at compile time.'],
  ['`type: number` measures over other measures', '`measure.derived()`', 'Formulas use helpers such as divide() and nullIfZero(), not SQL strings.'],
  ['Views', 'The datasets you publish to `serve()`', 'What consumers and agents are allowed to see.'],
  ['`query_rewrite` and access policies on the security context', '`tenantKey`', 'Filled from the authenticated session; a query without it fails.'],
  ['Pre-aggregations in Cube Store', 'ClickHouse materialized views and projections', 'hypequery has no cache of its own; ClickHouse does the work.'],
  ['REST, GraphQL and SQL APIs', 'Serve HTTP API, React hooks, MCP server', 'Run inside your existing backend, not as a separate service.'],
];

const compareRows = [
  ['Where definitions live', 'YAML or JavaScript files in a Cube project (model/cubes, model/views), with optional Jinja and Python templating', 'TypeScript or Python files in your application repo'],
  ['What you run', 'A Cube service (API instances, a refresh worker, and Cube Store for pre-aggregations), self-hosted or in Cube Cloud', 'A library inside your existing backend'],
  ['How consumers query', 'REST (JSON) and GraphQL for apps, a SQL API over the Postgres protocol for BI tools; DAX (Power BI) and MDX (Excel) on Enterprise; an MCP server in Cube Cloud', 'Direct calls in your backend, a typed HTTP API, React hooks and an MCP server'],
  ['Databases', 'Many warehouses and databases, including ClickHouse. Pre-aggregations on ClickHouse need indexes', 'ClickHouse'],
  ['Per-customer data', 'A security context from a signed JWT, applied through query_rewrite or access policies with row-level filters', 'A tenant key on the dataset, filled from the authenticated session'],
  ['Caching', 'Pre-aggregations built into Cube Store on a refresh_key schedule, plus an in-memory cache', 'None of its own; use ClickHouse materialized views'],
  ['Types', 'Validated when the model compiles', 'Checked by the TypeScript compiler from dataset to response row'],
  ['Licence', 'Cube Core backend Apache 2.0, client libraries MIT. Cube Cloud is commercial', 'Apache 2.0'],
];

const faqItems: FaqItem[] = [
  {
    question: 'What is the Cube semantic layer?',
    answer:
      'Cube is a semantic layer you run as a service between your databases and the tools that query them. You define cubes (usually one per table), their measures, dimensions and joins, and views that choose what consumers see. Apps, BI tools, spreadsheets and AI agents then ask Cube for measures by name, and Cube writes the SQL.',
  },
  {
    question: 'Is Cube open source?',
    answer:
      'Cube Core is. Its backend is Apache 2.0 and its client libraries are MIT. Cube Cloud, the hosted product, is commercial. It adds features such as the MCP server, available on all Cloud plans, and, on Enterprise, the DAX and MDX APIs.',
  },
  {
    question: 'What is the difference between a cube and a view in Cube?',
    answer:
      'A cube maps to a table and holds its measures, dimensions and joins. A view is the public face of the model. It picks members from one or more cubes along a join path, can rename or prefix them, and is what BI tools, apps and agents are meant to query.',
  },
  {
    question: 'How do you query the Cube semantic layer?',
    answer:
      'Four ways. The REST (JSON) API and GraphQL API suit applications and embedded analytics. The SQL API speaks the Postgres wire protocol, so BI tools and SQL clients connect as if to Postgres and use MEASURE() for measures. The DAX and MDX APIs connect Power BI and Excel on the Enterprise plan.',
  },
  {
    question: 'Does Cube work with ClickHouse?',
    answer:
      'Yes, ClickHouse is a supported data source. Pre-aggregations on ClickHouse must define indexes, and they cannot use count_distinct_approx measures.',
  },
  {
    question: 'How does Cube handle multi-tenancy?',
    answer:
      'Each request carries a security context, usually from a signed JWT. The query_rewrite option can add filters from it to every query, access policies can apply row-level filters, and COMPILE_CONTEXT can compile a different data model per tenant.',
  },
  {
    question: 'What are pre-aggregations in Cube?',
    answer:
      'Pre-aggregations are rollup tables Cube builds from your model and stores in Cube Store, its own storage layer, refreshed on a schedule set by refresh_key (every hour by default). Queries that match a rollup are served from it instead of the source database.',
  },
];

const sources = [
  {
    vendor: 'Cube docs (cube-js/cube repository)',
    urls: [
      'https://github.com/cube-js/cube/blob/master/docs-mintlify/docs/data-modeling/overview.mdx',
      'https://github.com/cube-js/cube/blob/master/docs-mintlify/docs/data-modeling/concepts/syntax.mdx',
      'https://github.com/cube-js/cube/blob/master/docs-mintlify/docs/data-modeling/joins.mdx',
      'https://github.com/cube-js/cube/blob/master/docs-mintlify/docs/data-modeling/views.mdx',
      'https://github.com/cube-js/cube/blob/master/docs-mintlify/reference/data-modeling/measures.mdx',
      'https://github.com/cube-js/cube/blob/master/docs-mintlify/reference/data-modeling/pre-aggregations.mdx',
      'https://github.com/cube-js/cube/blob/master/docs-mintlify/docs/data-modeling/access-control/context.mdx',
      'https://github.com/cube-js/cube/blob/master/docs-mintlify/docs/data-modeling/access-control/row-level-security.mdx',
    ],
  },
  {
    vendor: 'Cube APIs and data sources',
    urls: [
      'https://github.com/cube-js/cube/blob/master/docs-mintlify/reference/core-data-apis/index.mdx',
      'https://github.com/cube-js/cube/blob/master/docs-mintlify/reference/core-data-apis/sql-api/query-format.mdx',
      'https://github.com/cube-js/cube/blob/master/docs-mintlify/reference/core-data-apis/queries.mdx',
      'https://github.com/cube-js/cube/blob/master/docs-mintlify/reference/core-data-apis/dax-api/index.mdx',
      'https://github.com/cube-js/cube/blob/master/docs-mintlify/reference/core-data-apis/mdx-api.mdx',
      'https://github.com/cube-js/cube/blob/master/docs-mintlify/admin/connect-to-data/data-sources/clickhouse.mdx',
      'https://github.com/cube-js/cube/blob/master/docs-mintlify/docs/integrations/mcp-server.mdx',
      'https://github.com/cube-js/cube',
    ],
  },
];

export default function CubeSemanticLayerPage() {
  return (
    <HubShell
      path={PATH}
      breadcrumbs={spokeBreadcrumbs('Cube semantic layer')}
      title="The Cube semantic layer: how it works"
      lead={
        <p>
          How Cube models data with cubes, views, measures and joins, how apps and BI tools query it, how it caches
          and scopes data per customer, and how the same model looks when it lives in your application code.
        </p>
      }
      primaryCta={{ href: '#how-it-works', label: 'How it works', target: 'cube_how_it_works' }}
      secondaryCta={{ href: '#compare', label: 'Compare', target: 'cube_compare' }}
      definition={{
        term: 'What is the Cube semantic layer?',
        body: (
          <>
            <p>
              Cube is a <Link href="/semantic-layer" className={inlineLink}>semantic layer</Link> that runs as its own
              service between your databases and everything that queries them. You describe each table as a{' '}
              <strong className="text-text">cube</strong> with measures, dimensions and joins, then publish{' '}
              <strong className="text-text">views</strong> that choose what consumers can see. A dashboard, a
              spreadsheet or an AI agent asks for revenue by country, and Cube writes the SQL for your database.
            </p>
            <p>
              The open-source part is <strong className="text-text">Cube Core</strong> (Apache 2.0). Cube Cloud is the
              hosted product, which Cube now sells as an agentic analytics platform built on the semantic layer.
            </p>
          </>
        ),
      }}
      jsonLd={[spokeArticleJsonLd({ path: PATH, title: TITLE, description: DESCRIPTION, dateModified: updatedFor(PATH) }), faqJsonLd(faqItems)]}
    >
      <HubSection
        id="how-it-works"
        eyebrow="How it works"
        title="Cubes, views, and four ways to query them"
        intro={
          <>
            <p>
              A <strong className="text-text">cube</strong> usually maps to one table through{' '}
              <code className={inlineCode}>sql_table</code>. Its <strong className="text-text">dimensions</strong> are
              columns you group and filter by (<code className={inlineCode}>string</code>,{' '}
              <code className={inlineCode}>number</code>, <code className={inlineCode}>time</code> and so on), its{' '}
              <strong className="text-text">measures</strong> are aggregates (<code className={inlineCode}>sum</code>,{' '}
              <code className={inlineCode}>count</code>, <code className={inlineCode}>count_distinct</code>,{' '}
              <code className={inlineCode}>avg</code>, or <code className={inlineCode}>number</code> for arithmetic on
              other measures), and its <strong className="text-text">joins</strong> declare one-to-one, one-to-many or
              many-to-one relationships so Cube can write multi-table SQL without double counting.
            </p>
            <p>
              A <strong className="text-text">view</strong> follows a join path through those cubes and includes the
              members consumers should use. Model files live in <code className={inlineCode}>model/cubes</code> and{' '}
              <code className={inlineCode}>model/views</code>, in YAML or JavaScript.
            </p>
          </>
        }
      >
        <CodePair
          left={{ code: cubeModel, filename: 'model/', language: 'yaml' }}
          right={{ code: cubeQuery, filename: 'querying the sales view', language: 'bash' }}
        />
        <p className="mt-4 text-xs leading-5 text-text-dim">
          The customers cube (not shown) declares customer_id as its primary key and a country dimension. With{' '}
          <code className={inlineCode}>prefix: true</code>, the view exposes it as{' '}
          <code className={inlineCode}>customers_country</code>.
        </p>
      </HubSection>

      <HubSection band eyebrow="Facts to know" title="Where the Cube semantic layer stands in late 2026">
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          <div className={marketing.card}>
            <h3 className="text-[17px] font-medium tracking-tight text-text">Open source and Cloud</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              Cube Core is Apache 2.0 (clients MIT). The MCP server is a Cube Cloud feature on all plans; the DAX and
              MDX APIs need the Enterprise plan.
            </p>
          </div>
          <div className={marketing.card}>
            <h3 className="text-[17px] font-medium tracking-tight text-text">Four APIs</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              REST (JSON) and GraphQL for apps and embedded analytics; a SQL API on the Postgres wire protocol for BI
              tools, with <code className={inlineCode}>MEASURE()</code>; DAX and MDX for Power BI and Excel.
            </p>
          </div>
          <div className={marketing.card}>
            <h3 className="text-[17px] font-medium tracking-tight text-text">Caching</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              Pre-aggregations are rollups stored in Cube Store and refreshed on a refresh_key schedule, every hour by
              default. On ClickHouse they must define indexes.
            </p>
          </div>
          <div className={marketing.card}>
            <h3 className="text-[17px] font-medium tracking-tight text-text">Access control</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              A security context from a signed JWT feeds query_rewrite, access policies with row-level filters, and
              per-tenant models through COMPILE_CONTEXT.
            </p>
          </div>
        </div>
      </HubSection>

      <HubSection
        eyebrow="The same model in code"
        title="The orders model as a code-defined semantic layer"
        intro={
          <p>
            Here is the same model as hypequery datasets. It is one file in your application repo, imported by the
            backend that serves your product. There is no separate service. The tenant key does the job of a query_rewrite
            filter, and the backend fills it from the signed-in session on every request.
          </p>
        }
      >
        <CodePair left={{ code: codeModel, filename: 'datasets/orders.ts' }} right={{ code: codeQuery, filename: 'analytics.ts' }} />
        <div className="mt-8">
          <HubTable
            caption="Cube concepts and their equivalents in a code-defined semantic layer"
            columns={['Cube', 'hypequery', 'Notes']}
            rows={mappingRows}
          />
        </div>
      </HubSection>

      <HubSection
        id="compare"
        band
        eyebrow="Comparison"
        title="Cube vs a semantic layer in code"
        intro={<p>Checked against Cube&rsquo;s documentation on {VERIFIED_ON}.</p>}
      >
        <HubTable
          caption={`The Cube semantic layer compared with a code-defined semantic layer, checked ${VERIFIED_ON}`}
          columns={['', 'Cube', 'Code-defined (hypequery)']}
          rows={compareRows}
        />
        <p className="mt-6 text-sm leading-6 text-text-muted">
          For a product-level comparison, see{' '}
          <Link href="/compare/hypequery-vs-cube" className={inlineLink}>
            hypequery vs Cube
          </Link>
          . If you are replacing Cube on ClickHouse, the{' '}
          <Link href="/cube-js-alternative" className={inlineLink}>
            Cube.js alternative guide
          </Link>{' '}
          covers migration.
        </p>
      </HubSection>

      <HubSection
        eyebrow="An honest answer"
        title="When Cube is the better choice"
        intro={
          <>
            <ul className="list-disc space-y-2 pl-5">
              <li>One model has to serve several databases, or several teams and products, from one place.</li>
              <li>BI tools, spreadsheets or Power BI are major consumers, and you want them on the same metrics as your apps.</li>
              <li>You need a managed cache in front of a slow or expensive warehouse, and pre-aggregations fit your query patterns.</li>
              <li>You are happy to run, or pay for, a separate service with its own deployment and monitoring.</li>
            </ul>
            <p>
              A code-defined layer fits when the main consumer is your own product on ClickHouse: customer-facing
              dashboards, a public API or an in-app agent, where the backend already knows which customer is asking
              and ClickHouse is fast enough without a separate cache. The{' '}
              <Link href="/semantic-layer/open-source-tools" className={inlineLink}>
                open-source semantic layer comparison
              </Link>{' '}
              puts Cube Core next to MetricFlow, Wren AI, Lightdash and others.
            </p>
          </>
        }
      />

      <HubSection band eyebrow="Questions" title="Cube semantic layer FAQ">
        <HubFaq items={faqItems} />
      </HubSection>

      <SemanticLayerGuides currentHref={PATH} />
      <HubSources checkedOn={VERIFIED_ON} sources={sources} />
      <SemanticLayerNextStep location="cube_semantic_layer_next_step" />
    </HubShell>
  );
}
