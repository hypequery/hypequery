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

const PATH = '/semantic-layer/databricks-metric-views';
const TITLE = 'Databricks Metric Views vs a Code-Defined Semantic Layer';
const DESCRIPTION =
  'How Unity Catalog metric views work: the YAML definition, querying with MEASURE(), Genie and BI tools, governance and the Apache Spark 4.2 release, compared with a semantic layer defined in code.';
const VERIFIED_ON = 'November 10, 2026';

export const metadata = spokeMetadata({ path: PATH, title: TITLE, description: DESCRIPTION });

const createView = `CREATE OR REPLACE VIEW analytics.sales.orders_metrics
WITH METRICS LANGUAGE YAML AS
$$
version: 1.1
comment: Revenue by customer
source: analytics.sales.orders
filter: status != 'test'
joins:
  - name: customer
    source: analytics.sales.customers
    on: source.customer_id = customer.customer_id
fields:
  - name: Customer country
    expr: customer.country
  - name: Order month
    expr: DATE_TRUNC('MONTH', ordered_at)
measures:
  - name: Revenue
    expr: SUM(amount)
  - name: Average order value
    expr: SUM(amount) / COUNT(order_id)
$$;`;

const queryView = `-- Every measure is wrapped in MEASURE()
SELECT
  \`Customer country\`,
  \`Order month\`,
  MEASURE(\`Revenue\`),
  MEASURE(\`Average order value\`)
FROM analytics.sales.orders_metrics
GROUP BY ALL
ORDER BY 3 DESC;

-- SELECT * is not supported, and a metric view cannot be
-- joined directly. Join its result through a CTE instead:
WITH by_country AS (
  SELECT \`Customer country\` AS country, MEASURE(\`Revenue\`) AS revenue
  FROM analytics.sales.orders_metrics
  GROUP BY ALL
)
SELECT t.region, SUM(b.revenue)
FROM by_country b
JOIN analytics.ref.country_regions t ON t.country = b.country
GROUP BY ALL;`;

const codeModel = `// datasets/orders.ts
import { belongsTo, dataset, dimension, divide, measure, nullIfZero } from '@hypequery/datasets';

const Customers = dataset('customers', {
  source: 'customers',
  tenantKey: 'tenant_id',
  dimensions: {
    id: dimension.string({ column: 'customer_id' }),
    country: dimension.string({ label: 'Customer country' }),
  },
});

const notTest = [{ field: 'status', operator: 'neq', value: 'test' }] as const;

export const Orders = dataset('orders', {
  source: 'orders',
  tenantKey: 'tenant_id',
  timeKey: 'ordered_at',
  dimensions: {
    status: dimension.string(),
    orderedAt: dimension.timestamp({ column: 'ordered_at' }),
  },
  measures: {
    revenue: measure.sum('amount', { filters: [...notTest] }),
    orderCount: measure.count('order_id', { filters: [...notTest] }),
    averageOrderValue: measure.derived({
      uses: { revenue: 'revenue', orders: 'orderCount' },
      formula: ({ revenue, orders }) => divide(revenue, nullIfZero(orders)),
    }),
    trailingRevenue: measure.trailing('revenue', { amount: 7, unit: 'day' }),
  },
  relationships: {
    customer: belongsTo(() => Customers, { from: 'customer_id', to: 'customer_id' }),
  },
});`;

const codeQuery = `// Grouped by month and customer country, for one customer
const result = await analytics.execute(
  Orders,
  {
    by: 'month',
    dimensions: ['customer.country'],
    measures: ['revenue', 'averageOrderValue'],
    orderBy: [{ field: 'revenue', direction: 'desc' }],
  },
  { runtime: { tenant: { id: session.orgId } } },
);

// result.data[0]['customer.country'] is typed: string | null | undefined`;

const mappingRows = [
  ['`source`', 'Dataset `source`', 'A table or view. Point it at a view for a query-shaped source.'],
  ['`joins` (many-to-one)', '`belongsTo`, `hasOne`', 'To-one joins, one hop deep; hasMany is metadata only.'],
  ['`fields` (formerly dimensions)', 'Dimensions', 'Time grains come from `timeKey` and `by` instead of one field per grain.'],
  ['`measures`', '`measure.sum()`, `count()`, `derived()`', 'Queries are checked against declared measure names at compile time; backing column names are checked when the query runs.'],
  ['Measure `window`', '`measure.trailing()`, `toDate()`, `cumulative()`', 'Trailing windows, to-date periods and running totals.'],
  ['Top-level `filter`', 'Measure filters, or a filtered view as the source', 'Datasets have no single dataset-wide filter.'],
  ['`materialization`', 'ClickHouse materialized views or projections', 'Defined in ClickHouse; point a dataset at the rollup table.'],
  ['`MEASURE()`', '`analytics.execute()`', 'Or the Serve HTTP API, React hooks and MCP.'],
  ['Unity Catalog privileges', '`tenantKey`', 'Filled from the authenticated session on each request.'],
];

const compareRows = [
  ['Where definitions live', 'A Unity Catalog view, defined in YAML through SQL DDL or Catalog Explorer', 'TypeScript or Python files in your application repo'],
  ['How consumers query', 'SQL with MEASURE() from the SQL editor, notebooks, AI/BI dashboards, Genie and alerts; BI tools through SQL or native integrations', 'Direct calls in your backend, a typed HTTP API, React hooks and an MCP server'],
  ['Databases', 'Databricks. The core also ships in Apache Spark 4.2', 'ClickHouse'],
  ['Per-customer data', 'Anyone with SELECT on the view can query it. Row filters and column masks cannot be set on a view, and a view over filtered or masked tables cannot be materialized', 'A tenant key on the dataset, filled from the authenticated session; a query without it fails'],
  ['Query restrictions', 'No SELECT *, and no direct joins with other tables', 'Joins are declared on the dataset; the query names fields'],
  ['Change process', 'CREATE OR REPLACE or ALTER VIEW, which replaces the whole YAML', 'A pull request, reviewed and deployed with the code that uses it'],
  ['Pre-aggregation', 'A materialization block, built by a managed Lakeflow pipeline and billed as serverless DBUs', 'ClickHouse materialized views or projections you define'],
  ['Price', 'No separate charge is documented; queries use your compute', 'Apache 2.0, free; runs on your ClickHouse'],
];

const faqItems: FaqItem[] = [
  {
    question: 'What are Databricks metric views?',
    answer:
      'Metric views are Unity Catalog objects that define measures separately from the fields you group and filter by. You define a measure such as revenue once in YAML, and Databricks computes it at query time for whatever grouping the query asks for. A standard view fixes its aggregation when it is created.',
  },
  {
    question: 'Are Databricks metric views generally available?',
    answer:
      'Yes. Metric views became generally available on April 2, 2026, as part of Unity Catalog Business Semantics. They need Databricks Runtime 16.4 or later, with some features on newer runtimes; SQL warehouses always run the latest version. Relationships between metric views are in beta.',
  },
  {
    question: 'How do you query a metric view?',
    answer:
      'With SQL that wraps each measure in MEASURE(), for example SELECT `Customer country`, MEASURE(`Revenue`) FROM orders_metrics GROUP BY ALL. SELECT * is not supported, and a metric view cannot be joined directly with other tables; put the query in a CTE and join that.',
  },
  {
    question: 'Are Databricks metric views open source?',
    answer:
      'The core is. Databricks contributed metric views to Apache Spark, and Spark 4.2.0 ships them as CREATE VIEW ... WITH METRICS (SPARK-54119). Unity Catalog features such as materialization, Genie and Catalog Explorer authoring remain Databricks features.',
  },
  {
    question: 'Do row filters and column masks work with metric views?',
    answer:
      'They cannot be applied to the metric view itself, because Databricks does not allow row filters or masks on views. A metric view whose sources use row filters, column masks or ABAC cannot be materialized, and cannot be shared through OpenSharing.',
  },
  {
    question: 'Is Databricks part of Open Semantic Interchange?',
    answer:
      'Yes. Databricks joined in January 2026 and says it contributes to Apache Ossie, the name OSI took when it entered the Apache Incubator. The Ossie converters repository includes a Databricks metric views converter.',
  },
];

const sources = [
  {
    vendor: 'Databricks docs',
    urls: [
      'https://docs.databricks.com/aws/en/uc-semantics/metric-views/',
      'https://docs.databricks.com/aws/en/uc-semantics/metric-views/create',
      'https://docs.databricks.com/aws/en/uc-semantics/metric-views/yaml-reference',
      'https://docs.databricks.com/aws/en/uc-semantics/metric-views/query',
      'https://docs.databricks.com/aws/en/uc-semantics/metric-views/basic-modeling',
      'https://docs.databricks.com/aws/en/uc-semantics/metric-views/materialization',
      'https://docs.databricks.com/aws/en/uc-semantics/metric-views/manage',
      'https://docs.databricks.com/aws/en/uc-semantics/metric-views/feature-availability',
      'https://docs.databricks.com/aws/en/uc-semantics/metric-views/bi-tools',
      'https://docs.databricks.com/aws/en/tables/row-and-column-filters',
    ],
  },
  {
    vendor: 'Databricks and Apache Spark',
    urls: [
      'https://www.databricks.com/blog/redefining-semantics-data-layer-future-bi-and-ai',
      'https://www.databricks.com/blog/introducing-apache-spark-42',
      'https://spark.apache.org/releases/spark-release-4-2-0.html',
      'https://github.com/apache/ossie-converters',
    ],
  },
];

export default function DatabricksMetricViewsPage() {
  return (
    <HubShell
      path={PATH}
      breadcrumbs={spokeBreadcrumbs('Databricks metric views')}
      title="Databricks metric views, compared with a semantic layer in code"
      lead={
        <p>
          How Unity Catalog metric views are defined and queried, what reads them, how governance applies, and how the
          same model looks when it lives in your application code instead of the lakehouse.
        </p>
      }
      primaryCta={{ href: '#how-it-works', label: 'How it works', target: 'databricks_how_it_works' }}
      secondaryCta={{ href: '#compare', label: 'Compare', target: 'databricks_compare' }}
      definition={{
        term: 'What is a Databricks metric view?',
        body: (
          <>
            <p>
              A metric view is a Unity Catalog view, defined in YAML, that keeps measures separate from the fields you
              group by. You define revenue once; a query asks for revenue by customer country or by month, and
              Databricks computes it correctly for that grouping at query time.
            </p>
            <p>
              Databricks calls metric views the core of Unity Catalog business semantics. Dashboards, Genie and SQL
              users read the same definitions, governed by Unity Catalog privileges. The core implementation is now
              part of Apache Spark 4.2.
            </p>
          </>
        ),
      }}
      jsonLd={[spokeArticleJsonLd({ path: PATH, title: TITLE, description: DESCRIPTION, dateModified: '2026-11-10' }), faqJsonLd(faqItems)]}
    >
      <HubSection
        id="how-it-works"
        eyebrow="How it works"
        title="A YAML definition, queried with MEASURE()"
        intro={
          <>
            <p>
              The YAML names a <code className={inlineCode}>source</code> (a table, view, metric view or SQL query), an
              optional <code className={inlineCode}>filter</code> applied to every query, many-to-one{' '}
              <code className={inlineCode}>joins</code>, the <code className={inlineCode}>fields</code> you group by and
              the <code className={inlineCode}>measures</code>. Measures can carry a{' '}
              <code className={inlineCode}>window</code>, such as a trailing seven days, and the view can declare a{' '}
              <code className={inlineCode}>materialization</code> that Databricks keeps up to date and rewrites queries
              to use.
            </p>
            <p>
              Creating one needs SELECT on the source, CREATE TABLE and USE SCHEMA on the target schema, and a warehouse
              or cluster to run on. You can also build it in Catalog Explorer under Create, then Metric view.
            </p>
          </>
        }
      >
        <CodePair
          left={{ code: createView, filename: 'orders_metrics.sql', language: 'sql' }}
          right={{ code: queryView, filename: 'query_metric_view.sql', language: 'sql' }}
        />
      </HubSection>

      <HubSection band eyebrow="Facts to know" title="Where Databricks metric views stand in late 2026">
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          <div className={marketing.card}>
            <h3 className="text-[17px] font-medium tracking-tight text-text">Status</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              Generally available since April 2, 2026. Relationships between metric views are in beta and need Runtime
              19. Some YAML features need Runtime 17.3 to 19.
            </p>
          </div>
          <div className={marketing.card}>
            <h3 className="text-[17px] font-medium tracking-tight text-text">Open source</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              The core shipped in Apache Spark 4.2.0 as CREATE VIEW ... WITH METRICS. Materialization, Genie and Catalog
              Explorer authoring stay in Databricks.
            </p>
          </div>
          <div className={marketing.card}>
            <h3 className="text-[17px] font-medium tracking-tight text-text">BI tools</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              Power BI, Tableau and Sigma query metric views through custom or native SQL. Native integrations from
              Hex, Sigma, Omni and others were announced at GA; ThoughtSpot and Tableau are planned.
            </p>
          </div>
          <div className={marketing.card}>
            <h3 className="text-[17px] font-medium tracking-tight text-text">Joins</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              Joins must be many-to-one; one-to-many needs Runtime 18.1. For many-to-many data, the first matching row
              is used, and joined tables cannot have ARRAY or MAP columns.
            </p>
          </div>
        </div>
      </HubSection>

      <HubSection
        eyebrow="The same model in code"
        title="The orders metric view as a code-defined semantic layer"
        intro={
          <p>
            The same source, join, fields and measures as hypequery datasets, plus a trailing seven-day revenue window.
            The test-order exclusion becomes a filter on each measure, and per-customer access comes from a tenant key
            filled by your backend, not from catalog privileges.
          </p>
        }
      >
        <CodePair left={{ code: codeModel, filename: 'datasets/orders.ts' }} right={{ code: codeQuery, filename: 'analytics.ts' }} />
        <div className="mt-8">
          <HubTable
            caption="Databricks metric view concepts and their equivalents in a code-defined semantic layer"
            columns={['Databricks metric view', 'hypequery', 'Notes']}
            rows={mappingRows}
          />
        </div>
      </HubSection>

      <HubSection
        id="compare"
        band
        eyebrow="Comparison"
        title="Databricks metric views vs a semantic layer in code"
        intro={<p>Checked against Databricks&rsquo; docs and announcements on {VERIFIED_ON}.</p>}
      >
        <HubTable
          caption={`Databricks metric views compared with a code-defined semantic layer, checked ${VERIFIED_ON}`}
          columns={['', 'Databricks metric views', 'Code-defined (hypequery)']}
          rows={compareRows}
        />
      </HubSection>

      <HubSection
        eyebrow="An honest answer"
        title="When a Databricks metric view is the better choice"
        intro={
          <>
            <ul className="list-disc space-y-2 pl-5">
              <li>Your data is in the lakehouse, governed by Unity Catalog, and that is where metrics should live.</li>
              <li>Genie, AI/BI dashboards and SQL users are the consumers.</li>
              <li>You want Databricks to maintain pre-aggregations for you through materialization.</li>
              <li>You want a definition that also runs on open-source Apache Spark.</li>
            </ul>
            <p>
              A code-defined layer fits when the metrics feed your own product, read from ClickHouse, and must be scoped
              to one customer per request by the backend that already knows who is signed in. The{' '}
              <Link href="/embedded-analytics" className={inlineLink}>
                embedded analytics guide
              </Link>{' '}
              covers that case.
            </p>
          </>
        }
      />

      <HubSection band eyebrow="Questions" title="Databricks metric views FAQ">
        <HubFaq items={faqItems} />
      </HubSection>

      <SemanticLayerGuides currentHref={PATH} />
      <HubSources checkedOn={VERIFIED_ON} sources={sources} />
      <SemanticLayerNextStep location="databricks_metric_views_next_step" />
    </HubShell>
  );
}
