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
import { faqJsonLd, type FaqItem } from '@/lib/structured-data';

const PATH = '/semantic-layer/open-semantic-interchange';
const TITLE = 'Open Semantic Interchange (OSI), Now Apache Ossie, Explained';
const DESCRIPTION =
  'What Open Semantic Interchange is, why it was renamed Apache Ossie, who is behind it, what the spec covers and leaves out, which tools convert to it, and how it relates to a semantic layer defined in code.';
const VERIFIED_ON = 'November 10, 2026';

export const metadata = spokeMetadata({ path: PATH, title: TITLE, description: DESCRIPTION });

// Validated against core-spec/ossie-schema.json (0.3.0.dev0) on the verification date.
const ossieModel = `# sales.ossie.yaml (Apache Ossie 0.3.0.dev0)
version: 0.3.0.dev0
name: sales
ai_context:
  instructions: Use this model for revenue and order questions.
datasets:
  - name: orders
    source: analytics.public.orders
    primary_key: [order_id]
    fields:
      - name: order_id
        expression: { sql: order_id }
      - name: customer_id
        expression: { sql: customer_id }
      - name: status
        expression: { sql: status }
      - name: ordered_at
        expression: { sql: ordered_at }
        datatype: DateTime
        dimension: { is_time: true }
      - name: amount
        expression: { sql: amount }
        datatype: Decimal
    metrics:
      - name: revenue
        expression: { sql: SUM(amount) }
        ai_context:
          synonyms: [sales, total revenue]
  - name: customers
    source: analytics.public.customers
    primary_key: [customer_id]
    fields:
      - name: customer_id
        expression: { sql: customer_id }
      - name: country
        expression: { sql: country }
relationships:
  - name: orders_to_customers
    from: orders
    to: customers
    from_columns: [customer_id]
    to_columns: [customer_id]
metrics:
  - name: revenue_per_customer
    expression:
      sql: SUM(orders.amount) / COUNT(DISTINCT customers.customer_id)`;

const codeModel = `// datasets/sales.ts: the same model, defined in code
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
    revenue: measure.sum('amount', {
      description: 'Sales; total revenue.',
    }),
    // Derived measures combine measures on the same dataset, so the
    // customer count comes from the orders' customer_id column.
    customerCount: measure.countDistinct('customer_id'),
    revenuePerCustomer: measure.derived({
      uses: { revenue: 'revenue', customers: 'customerCount' },
      formula: ({ revenue, customers }) => divide(revenue, nullIfZero(customers)),
    }),
  },
  relationships: {
    customer: belongsTo(() => Customers, { from: 'customer_id', to: 'customer_id' }),
  },
});

// Ossie describes the model. Querying it is up to each tool:
await analytics.execute(Orders, {
  dimensions: ['customer.country'],
  measures: ['revenue', 'revenuePerCustomer'],
}, { runtime: { tenant: { id: session.orgId } } });`;

const timelineRows = [
  ['September 23, 2025', 'Snowflake announces Open Semantic Interchange with Salesforce, dbt Labs and RelationalAI, supported by BlackRock and 17 launch partners in all, including Cube, Hex, Sigma and ThoughtSpot.'],
  ['October 14, 2025', 'dbt Labs relicenses MetricFlow under Apache 2.0 as a reference implementation for OSI.'],
  ['November 13, 2025', 'AWS, Collibra, DataHub, Informatica, Starburst and others join the working group.'],
  ['December 11, 2025', 'Spec version 0.1.1, the only release so far, per the spec’s version history.'],
  ['January 27, 2026', 'The first spec is published under Apache 2.0. AtScale, Databricks, JetBrains, Lightdash and Qlik join.'],
  ['June 22, 2026', 'The project enters the Apache Incubator.'],
  ['July 2026', 'OSI is renamed Apache Ossie (incubating). The repository moves to apache/ossie.'],
  ['September 29, 2026', 'A separate apache/ossie-converters repository is created for converters between Ossie and other formats.'],
  ['October 30, 2026', 'CLICKHOUSE is added to the list of registered SQL dialect names.'],
];

const specRows = [
  ['Semantic model', '`version`, `name`, `datasets` (required), plus relationships, model-scoped metrics, `ai_context` and `custom_extensions`', 'One model per YAML or JSON document.'],
  ['Dataset', '`name` and `source` (required), primary and unique keys, fields, dataset-scoped metrics', 'A logical table over a physical table.'],
  ['Field', '`name` and `expression` (required), `datatype`, `dimension.is_time`, label', 'There is no separate dimension object: dimensions are fields.'],
  ['Relationship', '`from`, `to`, `from_columns`, `to_columns`', 'Many-to-one, by field names.'],
  ['Metric', 'A name and an aggregate expression, on a dataset or across the model', 'A metric cannot reference another metric.'],
  ['AI context', 'Instructions, synonyms and examples on the model, datasets, fields and metrics', 'For agents and natural-language tools.'],
  ['Expressions', 'Portable `OSSIE_SQL_2026`, with optional per-dialect variants', 'Registering a dialect does not mean Ossie supports querying in it.'],
];

const mappingRows = [
  ['Semantic model', 'A module of datasets', 'Imported by your backend.'],
  ['Dataset with `source` and `primary_key`', 'Dataset', '`source` is the ClickHouse table.'],
  ['Field', 'Dimension', 'A time field (`is_time`) becomes the `timeKey`.'],
  ['Dataset-scoped metric', 'Measure', 'Typed helpers instead of SQL strings.'],
  ['Model-scoped metric', '`measure.derived()` on one dataset', 'Derived measures combine measures on the same dataset only; a formula cannot reference a measure on a related dataset.'],
  ['Relationship', '`belongsTo`', 'Composite keys are supported.'],
  ['`ai_context`', '`label`, `description`', 'Exposed to agents over MCP.'],
  ['Not in the spec yet', 'Tenant key, Serve API, React hooks, MCP tools', 'Access control and querying are on Ossie’s roadmap, not in the spec.'],
];

const faqItems: FaqItem[] = [
  {
    question: 'What is Open Semantic Interchange (OSI)?',
    answer:
      'Open Semantic Interchange is a vendor-neutral, open-source specification for describing semantic models (datasets, fields, relationships and metrics) in YAML or JSON, so one definition can move between BI tools, semantic layers and AI tools. Snowflake announced it with partners in September 2025.',
  },
  {
    question: 'What is Apache Ossie?',
    answer:
      'Apache Ossie (incubating) is OSI’s new name. The project entered the Apache Software Foundation’s incubator on June 22, 2026, and the rename was announced in July 2026. The project says the spec, community and mission did not change. The repository is now apache/ossie.',
  },
  {
    question: 'Who is behind OSI?',
    answer:
      'Snowflake led the launch with Salesforce, dbt Labs and RelationalAI, supported by BlackRock. Databricks, AtScale, Qlik, Lightdash and others joined in January 2026, and Microsoft engineers contributed a Power BI converter. The project’s ecosystem page listed more than 70 organizations on November 10, 2026. Google and ClickHouse were not among them.',
  },
  {
    question: 'What version is the OSI spec?',
    answer:
      'The only release is 0.1.1, dated December 11, 2025. The main branch is a draft, 0.3.0.dev0, with breaking changes: one model per document with no semantic_model wrapper, and keys and metric expressions that refer to dataset fields rather than source columns. There will be no 0.2.0.',
  },
  {
    question: 'Is OSI a query language?',
    answer:
      'No. Ossie defines how a model is written down, not how it is queried. The expression language explicitly does not define a query interface. A relational query interface and a reference engine are drafts or future roadmap items.',
  },
  {
    question: 'Which tools support OSI?',
    answer:
      'Snowflake semantic views import and export Ossie YAML (version 0.1.1 for import), and dbt v1.12 reads Ossie files as an alternative to YAML. The apache/ossie-converters repository holds converters for dbt MetricFlow, Databricks metric views, Power BI, Salesforce, Cube, Lightdash and others. There is no ClickHouse converter yet.',
  },
];

const sources = [
  {
    vendor: 'Apache Ossie',
    urls: [
      'https://ossie.apache.org/updates/',
      'https://ossie.apache.org/ecosystem/',
      'https://incubator.apache.org/projects/ossie.html',
      'https://github.com/apache/ossie',
      'https://github.com/apache/ossie/blob/main/core-spec/spec.md',
      'https://github.com/apache/ossie/blob/main/core-spec/ossie-schema.json',
      'https://github.com/apache/ossie/blob/main/core-spec/expression_language.md',
      'https://github.com/apache/ossie/blob/main/extensions/dialects.md',
      'https://github.com/apache/ossie/blob/main/ROADMAP.md',
      'https://github.com/apache/ossie-converters',
    ],
  },
  {
    vendor: 'Snowflake and dbt Labs',
    urls: [
      'https://www.snowflake.com/en/news/press-releases/snowflake-salesforce-dbt-labs-and-more-revolutionize-data-readiness-for-ai-with-open-semantic-interchange-initiative/',
      'https://www.snowflake.com/en/blog/osi-initiative-expands-partners/',
      'https://www.snowflake.com/en/blog/open-semantic-interchanges-specs-finalized/',
      'https://www.snowflake.com/en/blog/apache-ossie-open-semantic-interchange-incubator/',
      'https://www.snowflake.com/en/blog/engineering/apache-ossie-microsoft-ecosystem-support/',
      'https://www.getdbt.com/blog/dbt-labs-affirms-commitment-to-open-semantic-interchange-by-open-sourcing-metricflow',
      'https://docs.getdbt.com/docs/build/ossie-semantic-models',
      'https://docs.snowflake.com/en/sql-reference/stored-procedures/system_create_semantic_view_from_ossie_yaml',
    ],
  },
];

export default function OpenSemanticInterchangePage() {
  return (
    <HubShell
      path={PATH}
      breadcrumbs={spokeBreadcrumbs('Open Semantic Interchange')}
      title="Open Semantic Interchange, now Apache Ossie, explained"
      lead={
        <p>
          What the spec is for, who is behind it, what a model file looks like, which tools convert to and from it, what
          it deliberately leaves out, and what it means if your semantic layer is defined in code.
        </p>
      }
      primaryCta={{ href: '#spec', label: 'Read the spec summary', target: 'osi_spec' }}
      secondaryCta={{ href: '#code', label: 'OSI and code', target: 'osi_code' }}
      definition={{
        term: 'What is Open Semantic Interchange?',
        body: (
          <>
            <p>
              Open Semantic Interchange (OSI) is an open, vendor-neutral specification for writing down a semantic
              model (datasets, fields, relationships and metrics, plus context for AI tools) as a YAML or JSON file, so
              the same definitions can move between warehouses, semantic layers, BI tools and agents instead of being
              rebuilt in each one.
            </p>
            <p>
              Snowflake launched it with dbt Labs, Salesforce, RelationalAI and other partners in September 2025. In
              2026 it entered the Apache Incubator and was renamed <strong className="text-text">Apache Ossie</strong>.
              It is licensed under Apache 2.0, and it describes models; it does not run queries.
            </p>
          </>
        ),
      }}
      jsonLd={[spokeArticleJsonLd({ path: PATH, title: TITLE, description: DESCRIPTION, dateModified: '2026-11-10' }), faqJsonLd(faqItems)]}
    >
      <HubSection
        eyebrow="Why it exists"
        title="Every semantic layer has its own format"
        intro={
          <>
            <p>
              The dbt Semantic Layer stores metrics in dbt YAML, Snowflake in semantic view DDL, Databricks in metric
              view YAML, Power BI in TMDL, Cube in its own data model files. A company that defines revenue in one of
              them has to define it again for every other tool, and the copies drift.
            </p>
            <p>
              OSI&rsquo;s answer is a shared file format that each tool can import and export, so a model written once
              can be converted rather than rewritten. The pressure comes largely from AI: agents need the same metric
              definitions and synonyms whichever tool they run in.
            </p>
          </>
        }
      />

      <HubSection band eyebrow="Timeline" title="From OSI to Apache Ossie">
        <HubTable caption="Open Semantic Interchange timeline" columns={['Date', 'What happened']} rows={timelineRows} />
      </HubSection>

      <HubSection
        id="spec"
        eyebrow="The spec"
        title="What an Ossie model contains"
        intro={
          <p>
            The core spec defines a single model per document. The only release is 0.1.1; the main branch is a draft,
            0.3.0.dev0, which removes the old <code className={inlineCode}>semantic_model</code> wrapper and makes keys
            and metric expressions refer to dataset fields rather than source columns. Files in the 0.1.1 shape fail the
            current schema.
          </p>
        }
      >
        <HubTable caption="Objects in the Apache Ossie core spec" columns={['Object', 'What it holds', 'Notes']} rows={specRows} />
      </HubSection>

      <HubSection
        id="code"
        band
        eyebrow="OSI and a code-defined layer"
        title="The same model as an Ossie file and as code"
        intro={
          <>
            <p>
              On the left, an orders and customers model in the current draft format. We checked it against the
              spec&rsquo;s JSON Schema on {VERIFIED_ON}. On the right, the same model as hypequery datasets. The shapes
              line up closely: dataset for dataset, field for dimension, metric for measure, relationship for{' '}
              <code className={inlineCode}>belongsTo</code>.
            </p>
            <p>
              What the code version adds is everything Ossie leaves to each tool: a tenant key enforced at query time,
              and the query itself, through function calls, an HTTP API, React hooks or MCP. hypequery does not read or
              write Ossie files today. Nor is there a ClickHouse converter yet: a proposal to add one to the Ossie
              repository was closed without merging in October 2026.
            </p>
          </>
        }
      >
        <CodePair
          left={{ code: ossieModel, filename: 'sales.ossie.yaml', language: 'yaml' }}
          right={{ code: codeModel, filename: 'datasets/sales.ts' }}
        />
        <div className="mt-8">
          <HubTable
            caption="Apache Ossie objects and their equivalents in a code-defined semantic layer"
            columns={['Apache Ossie', 'hypequery', 'Notes']}
            rows={mappingRows}
          />
        </div>
      </HubSection>

      <HubSection
        eyebrow="Adoption"
        title="Which tools read and write Ossie"
        intro={
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong className="text-text">Snowflake</strong>:{' '}
              <code className={inlineCode}>SYSTEM$CREATE_SEMANTIC_VIEW_FROM_OSSIE_YAML</code> imports a model (spec
              0.1.1) and <code className={inlineCode}>SYSTEM$READ_OSSIE_YAML_FROM_SEMANTIC_VIEW</code> exports one. See{' '}
              <Link href="/semantic-layer/snowflake-semantic-views" className={inlineLink}>
                Snowflake semantic views
              </Link>
              .
            </li>
            <li>
              <strong className="text-text">dbt</strong>: v1.12 reads Ossie JSON files as an alternative to YAML;
              support in dbt v2 is &ldquo;coming soon&rdquo;. See{' '}
              <Link href="/semantic-layer/dbt-metricflow" className={inlineLink}>
                dbt MetricFlow
              </Link>
              .
            </li>
            <li>
              <strong className="text-text">Converters</strong>: apache/ossie-converters has projects for dbt MetricFlow
              (both directions), Databricks metric views, Power BI and Fabric, Salesforce, Cube, Lightdash, Omni, Sigma,
              ThoughtSpot and more. The Snowflake-to-Cortex-Analyst converter is under active development.
            </li>
            <li>
              <strong className="text-text">Tooling in the main repo</strong>: a validator, a Python SDK (0.3.0.dev0, not
              on PyPI) and a compliance suite.
            </li>
          </ul>
        }
      />

      <HubSection
        band
        eyebrow="Limits"
        title="What Ossie does not cover yet"
        intro={
          <>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong className="text-text">Querying.</strong> The expression language does not define a query
                interface. A relational query interface is a draft, and a reference query engine is future work.
              </li>
              <li>
                <strong className="text-text">Access control.</strong> Governance, identity and access control are on the
                roadmap, not in the spec, so tenant and row rules stay in each tool.
              </li>
              <li>
                <strong className="text-text">Grain and non-additive metrics.</strong> The roadmap says the model lacks
                support for metrics at different grains, filters and aggregation semantics, and an open issue notes
                there is no way to declare a non-additive metric.
              </li>
              <li>
                <strong className="text-text">Stability.</strong> The main branch is a draft with breaking changes from
                the only release, so converters target different versions.
              </li>
            </ul>
            <p>
              None of this makes Ossie less useful as an exchange format. It does mean a semantic layer still needs its
              own runtime, its own access rules and its own query API, whichever format it imports.
            </p>
          </>
        }
      />

      <HubSection eyebrow="Questions" title="Open Semantic Interchange FAQ">
        <HubFaq items={faqItems} />
      </HubSection>

      <SemanticLayerGuides currentHref={PATH} />
      <HubSources checkedOn={VERIFIED_ON} sources={sources} />
      <SemanticLayerNextStep location="osi_next_step" />
    </HubShell>
  );
}
