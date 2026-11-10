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

const PATH = '/semantic-layer/dbt-metricflow';
const TITLE = 'dbt Semantic Layer and MetricFlow vs a Code-Defined Semantic Layer';
const DESCRIPTION =
  'How the dbt Semantic Layer and MetricFlow define and serve metrics in 2026: the new YAML spec, metric types, APIs, pricing and warehouse support, compared with a semantic layer defined in code.';
const VERIFIED_ON = 'November 10, 2026';

export const metadata = spokeMetadata({ path: PATH, title: TITLE, description: DESCRIPTION });

const dbtModel = `# models/orders.yml (latest metrics spec)
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
      - name: customer_id
        entity:
          type: foreign
          name: customer
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
      - name: order_count
        type: simple
        agg: count
        expr: order_id

# A ratio metric goes in the top-level metrics block
metrics:
  - name: average_order_value
    type: ratio
    numerator: revenue
    denominator: order_count`;

const dbtQuery = `# dbt platform or dbt v2
dbt sl query \\
  --metrics revenue,average_order_value \\
  --group-by metric_time__month,customer__country

# Open-source MetricFlow, run locally
mf query \\
  --metrics revenue,average_order_value \\
  --group-by metric_time__month,customer__country

# From a BI tool or app, over JDBC (Arrow Flight SQL)
select * from {{
  semantic_layer.query(
    metrics=['revenue', 'average_order_value'],
    group_by=[Dimension('metric_time').grain('month'), 'customer__country']
  )
}}`;

const codeModel = `// datasets/orders.ts
import { belongsTo, dataset, dimension, divide, measure, nullIfZero } from '@hypequery/datasets';

const Customers = dataset('customers', {
  source: 'customers',
  dimensions: {
    id: dimension.string(),
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
    customer: belongsTo(() => Customers, { from: 'customer_id', to: 'id' }),
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
  ['Semantic model', 'Dataset', 'One per table. `source` is the table.'],
  ['Primary and foreign entities', 'Relationships: `belongsTo`, `hasOne`', 'Declared on the dataset; to-one joins run one hop deep.'],
  ['Categorical and time dimensions', '`dimension.string()`, `dimension.timestamp()`, `timeKey`', 'The time key plays the part of agg_time_dimension.'],
  ['Simple metric (agg + expr)', '`measure.sum()`, `measure.count()` and friends', 'Measures are typed, so a misspelled column fails to compile.'],
  ['Ratio and derived metrics', '`measure.derived()`', 'Formulas use symbolic helpers such as divide() and nullIfZero(), not SQL strings.'],
  ['Cumulative metrics', '`measure.cumulative()`, `trailing()`, `toDate()`', 'Running totals, trailing windows and month-to-date.'],
  ['Conversion metrics', 'No direct equivalent', 'Write the funnel as its own dataset or query.'],
  ['metric_time__month', "`by: 'month'`", 'Grains from minute to year.'],
  ['Saved queries', 'A function or a Serve endpoint', 'Named, versioned with the code that calls it.'],
  ['Semantic Layer APIs', 'Serve HTTP API, React hooks, MCP server', 'Run in your own backend.'],
];

const compareRows = [
  ['Where definitions live', 'YAML in the dbt project, next to the models that build the tables', 'TypeScript or Python in your application repo'],
  ['Who usually owns them', 'Analytics engineers', 'Application engineers'],
  ['How consumers query', 'GraphQL, JDBC (Arrow Flight SQL) and Python APIs; integrations for Tableau, Power BI, Excel, Google Sheets, Hex, Sigma and others; dbt MCP server', 'Direct calls in your backend, a typed HTTP API, React hooks and an MCP server'],
  ['Databases', 'Hosted: Snowflake, BigQuery, Databricks, Redshift, Postgres, Trino. MetricFlow merged experimental ClickHouse support on September 29, 2026; it is not in a release yet', 'ClickHouse, including FINAL for ReplacingMergeTree tables'],
  ['Per-customer data', 'Queries run with the credentials configured for the Semantic Layer; rows are restricted by warehouse policies on those credentials', 'A tenant key on the dataset, filled from the authenticated session; a query without it fails'],
  ['Types', 'Validated when the project is parsed', 'Checked by the TypeScript compiler from dataset to response row'],
  ['What you run', 'The dbt platform hosts the APIs. MetricFlow alone gives you a CLI, not an API', 'A library inside your existing backend'],
  ['Price', 'Starter $100 per user per month with 5,000 queried metrics a month; Enterprise 20,000. MetricFlow is free', 'Apache 2.0, free'],
];

const faqItems: FaqItem[] = [
  {
    question: 'What is the dbt Semantic Layer?',
    answer:
      'The dbt Semantic Layer lets you define metrics in YAML on top of your dbt models and query them by name through APIs and BI integrations. dbt works out the joins. It is a paid feature of the dbt platform and is powered by MetricFlow.',
  },
  {
    question: 'Is MetricFlow open source?',
    answer:
      'Yes. dbt Labs announced at Coalesce in October 2025 that MetricFlow would be relicensed under Apache 2.0, and releases from 0.209.0 onward are Apache 2.0. Earlier versions were AGPL and then BSL. The hosted dbt Semantic Layer that runs on top of it remains proprietary.',
  },
  {
    question: 'What does the dbt Semantic Layer cost?',
    answer:
      'It is included from the Starter plan, $100 per user per month, which allows 5,000 queried metrics a month. Enterprise and Enterprise+ are custom priced and allow 20,000. The free Developer plan does not list it. You can run MetricFlow from the command line for free, without the APIs.',
  },
  {
    question: 'Does the dbt Semantic Layer support ClickHouse?',
    answer:
      'Not the hosted Semantic Layer: dbt lists Snowflake, BigQuery, Databricks, Redshift, Postgres and Trino. Open-source MetricFlow merged experimental ClickHouse support on September 29, 2026, after its latest release, and that change leaves out FINAL handling for ReplacingMergeTree tables.',
  },
  {
    question: 'What changed in the new dbt metrics spec?',
    answer:
      'Measures are deprecated and replaced with simple metrics, the semantic model sits inside each model entry, entities and dimensions move under columns, and type_params is gone. dbt-autofix deprecations --semantic-layer migrates existing YAML.',
  },
  {
    question: 'Can AI agents query dbt metrics?',
    answer:
      'Yes. The dbt MCP server, self-hosted or remote, exposes Semantic Layer tools to MCP clients such as Claude. Which tools are available depends on the APIs your dbt plan includes.',
  },
];

const sources = [
  {
    vendor: 'dbt docs',
    urls: [
      'https://docs.getdbt.com/docs/use-dbt-semantic-layer/dbt-sl',
      'https://docs.getdbt.com/docs/build/about-metricflow',
      'https://docs.getdbt.com/docs/build/latest-metrics-spec',
      'https://docs.getdbt.com/docs/build/metrics-overview',
      'https://docs.getdbt.com/docs/build/metricflow-commands',
      'https://docs.getdbt.com/docs/dbt-cloud-apis/sl-jdbc',
      'https://docs.getdbt.com/docs/cloud-integrations/avail-sl-integrations',
      'https://docs.getdbt.com/docs/use-dbt-semantic-layer/sl-faqs',
      'https://docs.getdbt.com/docs/dbt-ai/about-mcp',
    ],
  },
  {
    vendor: 'dbt Labs and MetricFlow',
    urls: [
      'https://www.getdbt.com/pricing',
      'https://www.getdbt.com/blog/dbt-labs-affirms-commitment-to-open-semantic-interchange-by-open-sourcing-metricflow',
      'https://www.getdbt.com/licenses-faq',
      'https://github.com/dbt-labs/metricflow',
      'https://github.com/dbt-labs/metricflow/pull/2124',
    ],
  },
];

export default function DbtMetricFlowPage() {
  return (
    <HubShell
      path={PATH}
      breadcrumbs={spokeBreadcrumbs('dbt MetricFlow')}
      title="dbt Semantic Layer and MetricFlow, compared with a semantic layer in code"
      lead={
        <p>
          How dbt defines metrics after the 2026 spec changes, how they are queried and priced, which warehouses they
          run on, and how the same model looks when it is defined in application code instead.
        </p>
      }
      primaryCta={{ href: '#how-it-works', label: 'How it works', target: 'dbt_how_it_works' }}
      secondaryCta={{ href: '#compare', label: 'Compare', target: 'dbt_compare' }}
      definition={{
        term: 'What are the dbt Semantic Layer and MetricFlow?',
        body: (
          <>
            <p>
              The <strong className="text-text">dbt Semantic Layer</strong> is dbt Labs&rsquo; service for defining
              metrics in YAML next to your dbt models and querying them by name, from BI tools, spreadsheets, notebooks
              and AI agents. You ask for revenue by customer country; it writes the joins and the SQL.
            </p>
            <p>
              <strong className="text-text">MetricFlow</strong> is the engine underneath: it reads the YAML and compiles
              metric requests into SQL for your warehouse. MetricFlow is open source under Apache 2.0. The hosted
              Semantic Layer, with its APIs and integrations, is part of the paid dbt platform.
            </p>
          </>
        ),
      }}
      jsonLd={[spokeArticleJsonLd({ path: PATH, title: TITLE, description: DESCRIPTION, dateModified: '2026-11-10' }), faqJsonLd(faqItems)]}
    >
      <HubSection
        id="how-it-works"
        eyebrow="How it works"
        title="Semantic models, metrics and queries"
        intro={
          <>
            <p>
              A <strong className="text-text">semantic model</strong> sits on top of one dbt model. It names the
              table&rsquo;s <strong className="text-text">entities</strong> (primary, foreign, unique or natural keys,
              which is how MetricFlow finds joins) and its <strong className="text-text">dimensions</strong>{' '}
              (categorical or time). <strong className="text-text">Metrics</strong> come in five types: simple, ratio,
              cumulative, derived and conversion.
            </p>
            <p>
              The latest spec, used by the dbt platform, dbt v2 and dbt v1.12, deprecates measures in favour of simple
              metrics, moves the semantic model inside each model entry and puts entities and dimensions under{' '}
              <code className={inlineCode}>columns</code>.{' '}
              <code className={inlineCode}>dbt-autofix deprecations --semantic-layer</code> migrates older YAML. dbt
              v1.12 can also read semantic models from{' '}
              <Link href="/semantic-layer/open-semantic-interchange" className={inlineLink}>
                Apache Ossie (OSI)
              </Link>{' '}
              files.
            </p>
          </>
        }
      >
        <CodePair
          left={{ code: dbtModel, filename: 'models/orders.yml', language: 'yaml' }}
          right={{ code: dbtQuery, filename: 'querying metrics', language: 'bash' }}
        />
        <p className="mt-4 text-xs leading-5 text-text-dim">
          The customer__country group-by assumes a customers model with a primary entity named customer and a country
          dimension. Add <code className={inlineCode}>--compile</code> (dbt) or{' '}
          <code className={inlineCode}>--explain</code> (mf) to see the generated SQL.
        </p>
      </HubSection>

      <HubSection
        band
        eyebrow="Facts to know"
        title="Where the dbt Semantic Layer stands in late 2026"
      >
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          <div className={marketing.card}>
            <h3 className="text-[17px] font-medium tracking-tight text-text">New names</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              In September 2026 dbt renamed the Fusion engine to &ldquo;dbt&rdquo; (v2). The Apache-licensed subset is
              dbt OSS, and the 1.x line is dbt v1, or dbt Core.
            </p>
          </div>
          <div className={marketing.card}>
            <h3 className="text-[17px] font-medium tracking-tight text-text">Open-source engine</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              MetricFlow is Apache 2.0 from version 0.209.0. Without a platform plan you can define and query metrics
              from the CLI, but you get no APIs or integrations.
            </p>
          </div>
          <div className={marketing.card}>
            <h3 className="text-[17px] font-medium tracking-tight text-text">Paid APIs</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              GraphQL, JDBC and the Python SDK come with Starter ($100 per user per month, 5,000 queried metrics a
              month) and above. Caching is Enterprise only.
            </p>
          </div>
          <div className={marketing.card}>
            <h3 className="text-[17px] font-medium tracking-tight text-text">ClickHouse</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              Not supported by the hosted Semantic Layer. MetricFlow merged experimental ClickHouse SQL on September 29,
              2026; it is not released, and FINAL for ReplacingMergeTree is out of scope.
            </p>
          </div>
        </div>
      </HubSection>

      <HubSection
        eyebrow="The same model in code"
        title="The orders model as a code-defined semantic layer"
        intro={
          <p>
            Here is the same model as a hypequery dataset: one file in your application repo, imported by the backend
            that serves your product. It adds the one thing the dbt version leaves to the warehouse, a tenant key, so
            each request only sees one customer&rsquo;s rows.
          </p>
        }
      >
        <CodePair
          left={{ code: codeModel, filename: 'datasets/orders.ts' }}
          right={{ code: codeQuery, filename: 'analytics.ts' }}
        />
        <div className="mt-8">
          <HubTable
            caption="dbt Semantic Layer concepts and their equivalents in a code-defined semantic layer"
            columns={['dbt / MetricFlow', 'hypequery', 'Notes']}
            rows={mappingRows}
          />
        </div>
      </HubSection>

      <HubSection
        id="compare"
        band
        eyebrow="Comparison"
        title="dbt Semantic Layer vs a semantic layer in code"
        intro={<p>Checked against dbt&rsquo;s docs and pricing page on {VERIFIED_ON}.</p>}
      >
        <HubTable
          caption={`dbt Semantic Layer compared with a code-defined semantic layer, checked ${VERIFIED_ON}`}
          columns={['', 'dbt Semantic Layer', 'Code-defined (hypequery)']}
          rows={compareRows}
        />
      </HubSection>

      <HubSection
        eyebrow="An honest answer"
        title="When the dbt Semantic Layer is the better choice"
        intro={
          <>
            <ul className="list-disc space-y-2 pl-5">
              <li>Your tables are already built in dbt on a supported warehouse, and analytics engineers own the metrics.</li>
              <li>The consumers are BI tools and spreadsheets: Tableau, Power BI, Excel, Google Sheets, Hex, Sigma.</li>
              <li>You need conversion metrics, which a code-defined layer does not model directly.</li>
              <li>Metrics are for internal reporting, where warehouse credentials and policies are the right access model.</li>
            </ul>
            <p>
              Define metrics in code when they serve your own product: customer-facing dashboards, a public API or an
              in-app agent, where each request belongs to one customer and your backend already knows which one. Many
              teams use both: dbt builds the tables, and the application layer defines what customers see. The{' '}
              <Link href="/blog/typescript-vs-dbt-clickhouse" className={inlineLink}>
                TypeScript vs dbt guide
              </Link>{' '}
              covers that split on ClickHouse.
            </p>
          </>
        }
      />

      <HubSection band eyebrow="Questions" title="dbt Semantic Layer FAQ">
        <HubFaq items={faqItems} />
      </HubSection>

      <SemanticLayerGuides currentHref={PATH} />
      <HubSources checkedOn={VERIFIED_ON} sources={sources} />
      <SemanticLayerNextStep location="dbt_metricflow_next_step" />
    </HubShell>
  );
}
