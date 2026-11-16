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

const PATH = '/semantic-layer/snowflake-semantic-views';
const TITLE = 'Snowflake Semantic Views vs a Code-Defined Semantic Layer';
const DESCRIPTION =
  'How Snowflake semantic views work: CREATE SEMANTIC VIEW, SEMANTIC_VIEW() and AGG(), Cortex Analyst and access policies, compared with a semantic layer in code.';
const VERIFIED_ON = 'November 10, 2026';

export const metadata = spokeMetadata({ path: PATH, title: TITLE, description: DESCRIPTION });

const createView = `CREATE SEMANTIC VIEW sales
  TABLES (
    orders AS analytics.public.orders
      PRIMARY KEY (order_id),
    customers AS analytics.public.customers
      PRIMARY KEY (customer_id)
  )
  RELATIONSHIPS (
    orders_to_customers AS orders (customer_id) REFERENCES customers
  )
  DIMENSIONS (
    customers.country AS customers.country
      WITH SYNONYMS = ('customer country'),
    orders.order_month AS DATE_TRUNC('month', orders.ordered_at)
  )
  METRICS (
    orders.revenue AS SUM(orders.amount)
      COMMENT = 'Order amount before refunds',
    orders.average_order_value AS AVG(orders.amount)
  )
  COMMENT = 'Revenue by customer';`;

const queryView = `-- The SEMANTIC_VIEW clause
SELECT * FROM SEMANTIC_VIEW(
    sales
    DIMENSIONS customers.country, orders.order_month
    METRICS orders.revenue, orders.average_order_value
  )
ORDER BY revenue DESC;

-- Standard SQL: the view in FROM, metrics in AGG()
SELECT country, AGG(revenue)
FROM sales
GROUP BY country;

-- Read the definition back as YAML, or as Apache Ossie YAML
SELECT SYSTEM$READ_YAML_FROM_SEMANTIC_VIEW('analytics.public.sales');
SELECT SYSTEM$READ_OSSIE_YAML_FROM_SEMANTIC_VIEW('analytics.public.sales');`;

const codeModel = `// datasets/sales.ts
import { belongsTo, dataset, dimension, measure } from '@hypequery/datasets';

const Customers = dataset('customers', {
  source: 'customers',
  tenantKey: 'tenant_id',
  dimensions: {
    id: dimension.string({ column: 'customer_id' }),
    country: dimension.string({
      label: 'Customer country',
      description: 'Billing country of the customer.',
    }),
  },
});

export const Orders = dataset('orders', {
  source: 'orders',
  tenantKey: 'tenant_id',
  timeKey: 'ordered_at',
  dimensions: {
    orderedAt: dimension.timestamp({ column: 'ordered_at' }),
  },
  measures: {
    revenue: measure.sum('amount', { description: 'Order amount before refunds.' }),
    averageOrderValue: measure.avg('amount'),
  },
  relationships: {
    customer: belongsTo(() => Customers, { from: 'customer_id', to: 'customer_id' }),
  },
});`;

const codeQuery = `// Same question, scoped to the signed-in customer
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

// Agents get the labels and descriptions over MCP:
//   npx hypequery mcp`;

const mappingRows = [
  ['Logical table in `TABLES`', 'Dataset', 'One per table; `source` is the physical table.'],
  ['`PRIMARY KEY` and `RELATIONSHIPS`', '`belongsTo`, `hasOne`', 'To-one joins, one hop deep.'],
  ['`FACTS`', 'Numeric dimensions', 'Row-level values that measures aggregate.'],
  ['`DIMENSIONS`', '`dimension.string()`, `timestamp()` and so on', 'Time grains come from `timeKey` and `by`, not one dimension per grain.'],
  ['`METRICS`', '`measure.sum()`, `avg()`, `derived()`', 'Derived measures combine others with symbolic formulas.'],
  ['`NON ADDITIVE BY`', 'No direct equivalent', 'Model semi-additive balances as their own dataset.'],
  ['`WITH SYNONYMS`, `COMMENT`', '`label`, `description`', 'Exposed to agents through MCP schema introspection.'],
  ['Row access policy on base tables', '`tenantKey`', 'Filled from the authenticated session per request.'],
  ['`SEMANTIC_VIEW()` or `AGG()`', '`analytics.execute()`', 'Or the Serve HTTP API and React hooks.'],
  ['Cortex Analyst, managed MCP server', 'hypequery MCP server', 'Tools are generated from the datasets.'],
];

const compareRows = [
  ['Where definitions live', 'A schema-level object in Snowflake, created with SQL DDL, YAML, the Snowsight wizard or a dbt package', 'TypeScript or Python files in your application repo'],
  ['How consumers query', 'SEMANTIC_VIEW() clause or standard SQL with AGG(); Cortex Analyst; Cortex Agents; Snowflake’s managed MCP server; BI tools such as Sigma and Hex', 'Direct calls in your backend, a typed HTTP API, React hooks and an MCP server'],
  ['Databases', 'Snowflake only', 'ClickHouse'],
  ['Per-customer data', 'Row access and masking policies set on base tables propagate to the view. Agents querying through Cortex Analyst also need SELECT on the base tables', 'A tenant key on the dataset, filled from the authenticated session; a query without it fails'],
  ['Change process', 'CREATE OR REPLACE, or CREATE OR ALTER (preview); Terraform support is planned', 'A pull request, reviewed and deployed with the code that uses it'],
  ['Types', 'Validated by Snowflake when the view is created', 'Checked by the TypeScript compiler from dataset to response row'],
  ['Portability', 'Exports its own YAML and Apache Ossie YAML; exports Tableau data sources (preview)', 'Plain code; no Ossie export today'],
  ['Price', 'No separate charge is documented: queries use warehouse compute. Cortex Analyst bills per message', 'Apache 2.0, free; runs on your ClickHouse'],
];

const faqItems: FaqItem[] = [
  {
    question: 'What is a Snowflake semantic view?',
    answer:
      'A semantic view is a schema-level Snowflake object that stores logical tables, the relationships between them, and named facts, dimensions and metrics. Snowflake treats it as metadata. Cortex Analyst, Cortex Agents and BI tools use it to turn business questions into correct SQL.',
  },
  {
    question: 'How do you query a Snowflake semantic view?',
    answer:
      'Two ways. The SEMANTIC_VIEW clause lists DIMENSIONS and METRICS, as in SELECT * FROM SEMANTIC_VIEW(sales DIMENSIONS customers.country METRICS orders.revenue). Or put the view in FROM and wrap metrics in AGG(), as in SELECT country, AGG(revenue) FROM sales GROUP BY country. The standard SQL form does not allow joins, window functions or QUALIFY.',
  },
  {
    question: 'Are Snowflake semantic views generally available?',
    answer:
      'Yes. Defining semantic views became generally available in June 2025, querying with the SEMANTIC_VIEW clause in August 2025, and querying with standard SQL on March 2, 2026. A few clauses, such as range joins and level-of-detail metrics, are still in preview.',
  },
  {
    question: 'Do row access policies apply to semantic views?',
    answer:
      'Policies cannot be set on semantic view attributes, but row access and masking policies on the underlying tables and columns propagate to the semantic view and are enforced. Sample values stored in the view are metadata and are not masked.',
  },
  {
    question: 'Can I define semantic views in YAML or dbt?',
    answer:
      'Yes. SYSTEM$CREATE_SEMANTIC_VIEW_FROM_YAML creates one from YAML and SYSTEM$READ_YAML_FROM_SEMANTIC_VIEW exports it. The Snowflake-Labs dbt_semantic_view package adds a semantic_view materialization to dbt.',
  },
  {
    question: 'Do Snowflake semantic views support Open Semantic Interchange?',
    answer:
      'Yes. SYSTEM$CREATE_SEMANTIC_VIEW_FROM_OSSIE_YAML imports an Apache Ossie (formerly OSI) model, supporting spec version 0.1.1, and SYSTEM$READ_OSSIE_YAML_FROM_SEMANTIC_VIEW exports one. Snowflake-only features are kept in vendor extensions.',
  },
];

const sources = [
  {
    vendor: 'Snowflake docs',
    urls: [
      'https://docs.snowflake.com/en/user-guide/views-semantic/overview',
      'https://docs.snowflake.com/en/sql-reference/sql/create-semantic-view',
      'https://docs.snowflake.com/en/user-guide/views-semantic/querying',
      'https://docs.snowflake.com/en/user-guide/views-semantic/sql',
      'https://docs.snowflake.com/en/user-guide/views-semantic/best-practices-dev',
      'https://docs.snowflake.com/en/user-guide/views-semantic/validation-rules',
      'https://docs.snowflake.com/en/sql-reference/stored-procedures/system_create_semantic_view_from_yaml',
      'https://docs.snowflake.com/en/sql-reference/stored-procedures/system_create_semantic_view_from_ossie_yaml',
      'https://docs.snowflake.com/en/sql-reference/functions/system_read_ossie_yaml_from_semantic_view',
    ],
  },
  {
    vendor: 'Snowflake release notes and Cortex',
    urls: [
      'https://docs.snowflake.com/en/release-notes/2025/june-summit',
      'https://docs.snowflake.com/en/release-notes/2025/9_25',
      'https://docs.snowflake.com/en/release-notes/2026/other/2026-03-02-semantic-views-standard-sql',
      'https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-analyst',
      'https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-mcp',
      'https://docs.snowflake.com/en/developer-guide/cortex-ai-cookbook/multi-tenant-agents',
      'https://github.com/Snowflake-Labs/dbt_semantic_view',
    ],
  },
];

export default function SnowflakeSemanticViewsPage() {
  return (
    <HubShell
      path={PATH}
      breadcrumbs={spokeBreadcrumbs('Snowflake semantic views')}
      title="Snowflake semantic views, compared with a semantic layer in code"
      lead={
        <p>
          How to define and query a Snowflake semantic view, what reads it, how access policies apply, and how the same
          model looks when it lives in your application code instead of the warehouse.
        </p>
      }
      primaryCta={{ href: '#how-it-works', label: 'How it works', target: 'snowflake_how_it_works' }}
      secondaryCta={{ href: '#compare', label: 'Compare', target: 'snowflake_compare' }}
      definition={{
        term: 'What is a Snowflake semantic view?',
        body: (
          <>
            <p>
              A semantic view is a Snowflake schema object that stores a semantic model: logical tables, how they join,
              and named facts, dimensions and metrics with descriptions and synonyms. You query it by naming the
              dimensions and metrics you want, and Snowflake writes the joins and aggregation.
            </p>
            <p>
              It is the model behind Cortex Analyst and Cortex Agents, Snowflake&rsquo;s natural-language and agent
              features, and BI tools can query it directly. Because it lives in Snowflake, it uses Snowflake&rsquo;s
              privileges and policies, and it only covers data in Snowflake.
            </p>
          </>
        ),
      }}
      jsonLd={[spokeArticleJsonLd({ path: PATH, title: TITLE, description: DESCRIPTION, dateModified: updatedFor(PATH) }), faqJsonLd(faqItems)]}
    >
      <HubSection
        id="how-it-works"
        eyebrow="How it works"
        title="CREATE SEMANTIC VIEW, then query it two ways"
        intro={
          <>
            <p>
              <code className={inlineCode}>TABLES</code> is the only required clause. The optional clauses follow in
              order: <code className={inlineCode}>RELATIONSHIPS</code>, <code className={inlineCode}>FACTS</code>{' '}
              (row-level values), <code className={inlineCode}>DIMENSIONS</code> and{' '}
              <code className={inlineCode}>METRICS</code>. Synonyms and comments are informational; they help Cortex
              Analyst and agents pick the right field. Creating one needs CREATE SEMANTIC VIEW on the schema and SELECT
              on the tables it references.
            </p>
            <p>
              You can query the view with the <code className={inlineCode}>SEMANTIC_VIEW()</code> clause, or, since
              March 2026, with ordinary SQL that wraps each metric in <code className={inlineCode}>AGG()</code>.
              Snowflake rewrites the second form into the first. A dimension&rsquo;s table must be related to the
              metric&rsquo;s table at the same or a coarser grain, which is why customer country works with an orders
              metric.
            </p>
          </>
        }
      >
        <CodePair
          left={{ code: createView, filename: 'create_semantic_view.sql', language: 'sql' }}
          right={{ code: queryView, filename: 'query_semantic_view.sql', language: 'sql' }}
        />
      </HubSection>

      <HubSection band eyebrow="Facts to know" title="Where Snowflake semantic views stand in late 2026">
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          <div className={marketing.card}>
            <h3 className="text-[17px] font-medium tracking-tight text-text">Status</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              Definitions GA since June 2025, the SEMANTIC_VIEW clause since August 2025, standard SQL since March 2,
              2026. CREATE OR ALTER, range joins and level-of-detail metrics are in preview.
            </p>
          </div>
          <div className={marketing.card}>
            <h3 className="text-[17px] font-medium tracking-tight text-text">Ways to author</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              SQL DDL, YAML through a system function, the Snowsight Semantic View Autopilot (which also ingests Tableau
              and Power BI files), or dbt with the dbt_semantic_view package.
            </p>
          </div>
          <div className={marketing.card}>
            <h3 className="text-[17px] font-medium tracking-tight text-text">Agents</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              Cortex Agents use a semantic view as a tool but generate SQL against the physical tables. The managed MCP
              server exposes semantic views through Cortex Analyst.
            </p>
          </div>
          <div className={marketing.card}>
            <h3 className="text-[17px] font-medium tracking-tight text-text">Materializations</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              Setting MAX_STALENESS (120 seconds minimum) and a warehouse pre-computes results, but only for semantic
              SQL queries; Cortex queries that run physical SQL do not use them.
            </p>
          </div>
        </div>
      </HubSection>

      <HubSection
        eyebrow="The same model in code"
        title="The sales view as a code-defined semantic layer"
        intro={
          <p>
            The same tables, join, dimension and metrics as hypequery datasets. Labels and descriptions play the part of
            synonyms and comments for agents. The difference is the tenant key: instead of a row access policy that
            depends on which database role runs the query, the backend passes the signed-in customer on every request.
          </p>
        }
      >
        <CodePair left={{ code: codeModel, filename: 'datasets/sales.ts' }} right={{ code: codeQuery, filename: 'analytics.ts' }} />
        <div className="mt-8">
          <HubTable
            caption="Snowflake semantic view concepts and their equivalents in a code-defined semantic layer"
            columns={['Snowflake semantic view', 'hypequery', 'Notes']}
            rows={mappingRows}
          />
        </div>
      </HubSection>

      <HubSection
        id="compare"
        band
        eyebrow="Comparison"
        title="Snowflake semantic views vs a semantic layer in code"
        intro={<p>Checked against Snowflake&rsquo;s docs and release notes on {VERIFIED_ON}.</p>}
      >
        <HubTable
          caption={`Snowflake semantic views compared with a code-defined semantic layer, checked ${VERIFIED_ON}`}
          columns={['', 'Snowflake semantic views', 'Code-defined (hypequery)']}
          rows={compareRows}
        />
      </HubSection>

      <HubSection
        eyebrow="An honest answer"
        title="When a Snowflake semantic view is the better choice"
        intro={
          <>
            <ul className="list-disc space-y-2 pl-5">
              <li>Your data is in Snowflake, and that is where the metrics should be governed.</li>
              <li>You want Cortex Analyst, Cortex Agents or Snowflake&rsquo;s MCP server to answer questions in plain language.</li>
              <li>Analysts and BI tools are the consumers, and Snowflake roles and policies are already your access model.</li>
              <li>You want nothing new to run: the view is metadata, and queries use the warehouses you already pay for.</li>
            </ul>
            <p>
              A code-defined layer fits when the metrics feed your own product rather than internal BI, and when that
              product reads from ClickHouse rather than Snowflake. If you use both, the{' '}
              <Link href="/semantic-layer/open-semantic-interchange" className={inlineLink}>
                Open Semantic Interchange spec
              </Link>{' '}
              is the likely way definitions will move between them, though there is no ClickHouse converter yet.
            </p>
          </>
        }
      />

      <HubSection band eyebrow="Questions" title="Snowflake semantic views FAQ">
        <HubFaq items={faqItems} />
      </HubSection>

      <SemanticLayerGuides currentHref={PATH} />
      <HubSources checkedOn={VERIFIED_ON} sources={sources} />
      <SemanticLayerNextStep location="snowflake_semantic_views_next_step" />
    </HubShell>
  );
}
