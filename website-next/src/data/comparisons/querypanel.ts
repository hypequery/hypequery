import { tenantScopedDatasetCode } from '@/data/comparisons/hypequery-code';
import type { ComparisonPage } from '@/data/comparisons/types';

const CHECKED = '2026-11-22';

export const querypanelComparison: ComparisonPage = {
  slug: 'hypequery-vs-querypanel',
  path: '/compare/hypequery-vs-querypanel',
  competitor: 'QueryPanel',
  primaryKeyword: 'querypanel alternative',
  title: 'QueryPanel Alternative: hypequery vs QueryPanel',
  description:
    'A QueryPanel alternative for ClickHouse: hosted text-to-SQL with tenant filters, or open-source metrics in code that run in your own backend.',
  h1: 'hypequery vs QueryPanel',
  published: CHECKED,
  verifiedOn: CHECKED,
  tldr: [
    'QueryPanel is a hosted service that turns plain-English questions into SQL and charts on your own database, with a React SDK for in-app dashboards and a Node SDK for headless use.',
    'It suits SaaS teams who want customers to ask questions in natural language and get a chart back, on Postgres, Redshift, ClickHouse, BigQuery or MySQL, without modelling metrics first.',
    'hypequery takes the opposite route. You define datasets and measures in TypeScript or Python, every query is compiled from those definitions with the tenant filter added in code, and it all runs in your backend under Apache 2.0.',
  ],
  rows: {
    deployment: {
      hypequery: 'Libraries in your backend; ClickHouse is the only service involved. hypequery Cloud (hosted) is in early access.',
      competitor:
        'Hosted API. With the React embed, QueryPanel holds the database credentials and runs queries; with the headless Node SDK, it generates SQL and your backend runs it.',
    },
    license: {
      hypequery: 'Apache 2.0, every package',
      competitor: 'Proprietary service. The React SDK and MCP plugin repos are MIT; the Node SDK is published as UNLICENSED.',
    },
    dataSources: {
      hypequery: 'ClickHouse only: ClickHouse Cloud, self-hosted ClickHouse, chDB',
      competitor: 'PostgreSQL, Redshift, ClickHouse, BigQuery and MySQL; Snowflake marked "Soon"',
    },
    clickhouse: {
      hypequery:
        'Built for ClickHouse. Types are generated from your live schema, SQL compiles straight to the ClickHouse dialect, and `FINAL` and query settings are supported',
      competitor:
        'Native adapter, `attachClickhouse`, that passes queries to your `@clickhouse/client` callback with `query_params` and `clickhouse_settings`',
    },
    tenantIsolation: {
      hypequery:
        '`tenantKey` per dataset, filled from your auth. Queries without a tenant fail, and callers cannot filter on the tenant column.',
      competitor:
        'Tenant column (`tenantFieldName`, `enforceTenantIsolation`), or one schema per tenant on Postgres and Redshift only. The model is told to bind the tenant field and the SQL is then checked.',
    },
    semanticLayer: {
      hypequery: 'Datasets with dimensions, measures (including derived), relationships, filters and limits, in code',
      competitor:
        'Retrieval context: glossary, column annotations and "gold SQL" examples. QueryPanel says it is not a LookML, MetricFlow or Cube-style metrics engine.',
    },
    api: {
      hypequery: 'Generated HTTP endpoints per dataset with request validation and OpenAPI; direct function calls in-process',
      competitor: '`qp.ask()` returns SQL, params, rows, a Vega-Lite chart spec and a rationale; schema sync, JWT minting and chart storage',
    },
    agents: {
      hypequery:
        'MCP server and generated tools over your datasets; agents choose measures and dimensions and never write SQL',
      competitor: 'Text-to-SQL is the core product. Hosted MCP server (OAuth) from the Starter plan',
    },
    embedding: {
      hypequery:
        'Headless: typed React hooks and HTTP endpoints, you draw the charts. Embeddable dashboards and chat in hypequery Cloud are coming soon.',
      competitor:
        'React component that renders in your React tree (not an iframe), with theming and tenant-level customisation; or headless via the Node SDK',
    },
    pricing: {
      hypequery: 'Open source and free. Cloud is in early access with no published price.',
      competitor:
        'Free (3 tenants, 50 AI charts a month), Starter $49, Growth $249, Scale $999 a month, Enterprise custom. Metered on monthly tenants and AI charts.',
    },
  },
  competitorBetterWhen: [
    'Your customers need to ask open-ended questions in plain English and get a chart back, and you have not decided which metrics matter yet. Text-to-SQL is QueryPanel’s core product and the model writes the query.',
    'Your data lives in Postgres, Redshift, BigQuery or MySQL. hypequery supports only ClickHouse.',
    'You want a finished in-app dashboard with an AI assistant this week rather than building chart components. QueryPanel ships a React component that renders dashboards in your app.',
    'You run several tenants per Postgres or Redshift schema and want schema-per-tenant isolation, which QueryPanel supports on those two databases.',
    'Your tenant count is small. The Free plan covers 3 tenants and Starter covers 10 for $49 a month, which is cheap for a pilot.',
  ],
  chooseHypequeryWhen: [
    'Your numbers must be the same every time. A measure defined as `measure.sum(\'amount\')` compiles to the same SQL for the dashboard, the API and the agent; nothing is generated per question.',
    'Tenant isolation has to be enforced in code. The compiler adds the tenant filter from your auth, and a query without one is rejected before it reaches ClickHouse.',
    'Schema details, user questions and database credentials must stay inside your infrastructure. hypequery runs in your process against your ClickHouse.',
    'Your backend is Python. hypequery datasets work from TypeScript and Python (beta); QueryPanel documents Node.js, Deno and Bun SDKs.',
    'You expect hundreds or thousands of tenants. hypequery has no per-tenant or per-chart metering because there is no service to meter.',
    'You want metric changes reviewed in pull requests. Datasets are source files, so a renamed measure fails the type check for every caller.',
  ],
  sections: [
    {
      id: 'text-to-sql-vs-metrics',
      eyebrow: 'The core difference',
      title: 'Generated SQL per question, or compiled SQL from definitions',
      paragraphs: [
        'QueryPanel starts from the question. Its Node SDK sends the question and synced schema context to QueryPanel’s API, a model writes SQL against your tables, and the response comes back with the SQL, its parameters, rows and a chart spec. Context comes from a glossary, column annotations and saved example queries, retrieved per question. QueryPanel’s own post on semantic layers says plainly that this is not a LookML, MetricFlow or Cube-style metrics engine.',
        'hypequery starts from the definition. You declare what revenue is once, the caller asks for `revenue` by `country`, and the compiler writes the SQL. There is no model in the query path, so the same request gives the same SQL every time, and a request for a measure that does not exist fails validation instead of producing a plausible query. That is what a [semantic layer](/semantic-layer) is for, and it is why the agent tools hypequery generates take measure and dimension names, not SQL.',
        'The tradeoff is coverage. A text-to-SQL product can attempt any question about any column on day one. hypequery answers only what you have modelled, so someone has to write the datasets. For customer-facing [embedded analytics](/embedded-analytics), where a wrong number goes straight to a customer, we think that is the right default; for exploratory internal questions it may not be.',
      ],
    },
    {
      id: 'tenant-isolation',
      eyebrow: 'Multi-tenancy',
      title: 'Where the tenant filter comes from',
      paragraphs: [
        'In QueryPanel you configure a tenant column (`tenantFieldName` with `enforceTenantIsolation: true`) and pass `tenantId` on each `ask()` call or in the RS256 embed JWT that `createJwt()` mints. QueryPanel describes the mechanism as instructing the SQL model to bind the tenant field, then verifying the generated SQL and parameters, with the headless SDK able to add a missing tenant predicate. On ClickHouse, isolation is by tenant column only; schema-per-tenant is documented for Postgres and Redshift.',
        'In hypequery the tenant column is part of the dataset (`tenantKey`). Serve extracts the tenant from your auth result, and the dataset compiler adds the predicate to every query. A request with no tenant throws, and a caller who tries to filter on the tenant column is rejected. Reading across tenants takes an explicit `{ in: [...] }` or `{ scope: \'all\' }` tenant value set by trusted server code. The [access control guide](/semantic-layer/access-control) has a test list for both approaches.',
      ],
    },
    {
      id: 'where-it-runs',
      eyebrow: 'Data flow',
      title: 'What leaves your infrastructure',
      paragraphs: [
        'QueryPanel has two paths. With the React embed, QueryPanel’s API resolves database credentials from its vault and runs the queries itself. With the headless Node SDK, it generates the SQL and your backend runs it through a callback, so rows and credentials stay with you, though questions and schema metadata still go to QueryPanel.',
        'hypequery has one path. Your backend imports the datasets and talks to ClickHouse directly. Nothing about your schema, questions or results is sent anywhere else. If you want a hosted version, hypequery Cloud is in early access, and it is an option rather than a requirement.',
      ],
    },
  ],
  code: {
    hypequery: tenantScopedDatasetCode,
  },
  faq: [
    {
      question: 'What is the difference between hypequery and QueryPanel?',
      answer:
        'QueryPanel is a hosted text-to-SQL service. A model writes SQL for each question against your database and returns rows and a chart. hypequery is an open-source semantic layer for ClickHouse. You define datasets and measures in TypeScript or Python, and every query is compiled from those definitions in your own backend.',
    },
    {
      question: 'Does QueryPanel support ClickHouse?',
      answer:
        'Yes. ClickHouse is one of five listed databases, with a native attachClickhouse adapter in the Node SDK that passes query parameters and ClickHouse settings to your own @clickhouse/client callback. Tenant isolation on ClickHouse uses a tenant column; schema-per-tenant isolation is documented for Postgres and Redshift only.',
    },
    {
      question: 'Is QueryPanel open source?',
      answer:
        'QueryPanel’s core service is proprietary. Its public repositories are SDKs and plugins. The React SDK and MCP plugin are MIT licensed, and the Node SDK is published as UNLICENSED (checked November 22, 2026). Every hypequery package is Apache 2.0.',
    },
    {
      question: 'How much does QueryPanel cost?',
      answer:
        'QueryPanel lists Free (3 tenants, 50 AI charts a month), Starter at $49, Growth at $249 and Scale at $999 a month, plus custom Enterprise pricing, metered on unique tenants per month and AI-generated charts. hypequery is free and open source; hypequery Cloud has no published price yet.',
    },
    {
      question: 'Can I use hypequery for natural-language questions?',
      answer:
        'Yes, through an agent. hypequery generates tools and an MCP server from your datasets, so a model such as Claude or GPT picks measures, dimensions and filters, and hypequery compiles the SQL. The agent can only ask for measures and dimensions you modelled. An embeddable chat component in hypequery Cloud is coming soon.',
    },
  ],
  sources: [
    { claim: 'QueryPanel turns plain-English questions into tenant-safe SQL and live charts on your existing database', url: 'https://querypanel.io', checkedAt: CHECKED },
    { claim: 'Supported databases: PostgreSQL, Redshift, ClickHouse, BigQuery, MySQL; Snowflake "Soon"', url: 'https://querypanel.io', checkedAt: CHECKED },
    { claim: 'Pricing tiers Free/Starter $49/Growth $249/Scale $999/Enterprise, metered on tenants and AI charts', url: 'https://querypanel.io/#pricing', checkedAt: CHECKED },
    { claim: 'MCP included from Starter', url: 'https://querypanel.io/#pricing', checkedAt: CHECKED },
    { claim: 'Node SDK: ask() returns sql, params, rows, chart.vegaLiteSpec, rationale; attachClickhouse adapter; syncSchema; createJwt; Node 18+, Deno, Bun', url: 'https://querypanel.io/docs/node-sdk', checkedAt: CHECKED },
    { claim: 'Tenant column isolation (tenantFieldName, enforceTenantIsolation) or schema-per-tenant for Postgres and Redshift only', url: 'https://querypanel.io/docs/tenant-isolation', checkedAt: CHECKED },
    { claim: 'React embed renders as React in your app tree, not an iframe', url: 'https://querypanel.io/docs/react-embed', checkedAt: CHECKED },
    { claim: 'React SDK is MIT per package README', url: 'https://querypanel.io/docs/react-sdk', checkedAt: CHECKED },
    { claim: 'Headful embed: QueryPanel API resolves vault-backed credentials and executes queries; headless keeps rows and credentials in customer infrastructure', url: 'https://querypanel.io/blog/semantic-layer-ai-agents-multi-tenant-analytics', checkedAt: CHECKED },
    { claim: 'Not a LookML, MetricFlow or Cube-style metrics engine; tenant field bound by instructing the SQL model, then verified', url: 'https://querypanel.io/blog/semantic-layer-ai-agents-multi-tenant-analytics', checkedAt: CHECKED },
    { claim: 'ClickHouse adapter passes query_params and clickhouse_settings to an @clickhouse/client callback', url: 'https://querypanel.io/blog/clickhouse-embedded-analytics-saas-2026', checkedAt: CHECKED },
    { claim: 'Hosted MCP server at mcp.querypanel.io with OAuth; plugin repo MIT', url: 'https://github.com/querypanel/mcp-plugin', checkedAt: CHECKED },
    { claim: 'Node SDK package.json licence UNLICENSED', url: 'https://github.com/querypanel/node-sdk', checkedAt: CHECKED },
  ],
  hubCard: {
    bestFitFor: 'Natural-language questions answered with generated SQL and charts, across Postgres, Redshift, ClickHouse, BigQuery or MySQL.',
    chooseHypequeryWhen: 'Numbers must come from reviewed metric definitions, tenant filters must be added by code, and everything must run in your backend.',
  },
};
