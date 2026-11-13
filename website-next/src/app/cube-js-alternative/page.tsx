import type { Metadata } from 'next';
import Link from 'next/link';
import CodeWindow from '@/components/CodeWindow';
import { HubFaq, HubLinkGrid, HubSection, HubShell, HubSources, HubTable, type HubLink } from '@/components/hub-page';
import { marketing } from '@/components/ui/marketing';
import { absoluteUrl, ogImage } from '@/lib/site';
import { faqJsonLd, techArticleJsonLd, type FaqItem } from '@/lib/structured-data';

// This URL used to hold a single "hypequery as a Cube.js alternative" page and
// already ranks for "cube.js alternatives". It now carries the multi-vendor
// Cube alternatives comparison instead of a second, competing page under /compare.
const PATH = '/cube-js-alternative';
const TITLE = '5 Best Cube.js Alternatives for Semantic Layers (2026)';
const DESCRIPTION =
  'Compare Cube with hypequery, dbt Semantic Layer, AtScale, GoodData and Boring Semantic Layer by databases, APIs, hosting and multi-tenancy.';
const PUBLISHED = '2026-04-25';
const UPDATED = '2026-11-12';
// Every competitor claim was checked on the vendor's own site on this date. See seo-verification-log.md.
const VERIFIED_ON = 'November 12, 2026';

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl(PATH) },
  openGraph: {
    type: 'article',
    url: absoluteUrl(PATH),
    title: TITLE,
    description: DESCRIPTION,
    images: ogImage('Cube alternatives: semantic layers compared'),
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },
};

const inlineLink =
  'font-medium text-text underline decoration-border-strong underline-offset-4 transition hover:text-accent hover:decoration-accent';
const inlineCode = 'font-mono text-[0.92em] text-text';
const extLink = 'underline decoration-border-strong underline-offset-4 hover:text-accent';

// Type-checked against @hypequery/datasets 0.30.0. The last call is deliberately wrong.
const driftCode = `// analytics/datasets.ts
export const Orders = dataset('orders', {
  source: 'orders',
  tenantKey: 'account_id',
  dimensions: { country: dimension.string() },
  measures: { revenue: measure.sum('amount') },
});

// app/routes/billing.ts
await analytics.execute(
  Orders,
  { dimensions: ['country'], measures: ['revenu'] },
  { runtime: { tenant: session.accountId } },
);
// error TS2769: No overload matches this call.
// The typo fails the type check in CI, before review.`;

const comparisonRows = [
  [
    'Cube',
    'YAML or JavaScript files in a model/ folder, read by the Cube service',
    'Usually a separate repo or service directory',
    'About 26 sources, including ClickHouse',
    'Security context from a JWT; queryRewrite and up to nine multitenancy options',
    'REST, GraphQL, SQL (Postgres wire); DAX and MDX on Enterprise',
    'Hosted MCP server with 30 tools, on all Cube Cloud plans',
    'Self-host Cube Core, or Cube Cloud',
    'Apache 2.0 backend, MIT client',
  ],
  [
    'hypequery',
    'TypeScript or Python modules imported by your app',
    'Yes',
    'ClickHouse only',
    'Tenant key on each dataset; queries without a tenant fail',
    'In-process calls, HTTP with OpenAPI, React hooks',
    '@hypequery/mcp exposes datasets and metrics as tools',
    'A library inside your backend; hosted cloud not live yet',
    'Apache 2.0',
  ],
  [
    'dbt Semantic Layer (MetricFlow)',
    'YAML next to dbt models',
    'No: in the dbt project',
    'Snowflake, BigQuery, Databricks, Redshift, Postgres, Trino (no ClickHouse)',
    'Warehouse credentials; multiple credentials on Enterprise',
    'GraphQL, JDBC, Python SDK (paid dbt plans)',
    'dbt MCP server (Apache 2.0)',
    'dbt platform (hosted)',
    'MetricFlow Apache 2.0; hosted layer commercial',
  ],
  [
    'AtScale',
    'SML: YAML files in Git',
    'No: in a model repo',
    'Snowflake, Databricks, BigQuery, Redshift, PostgreSQL and more (no ClickHouse)',
    'Not covered in sources checked',
    'XMLA with DAX and MDX; PostgreSQL interface',
    'Remote MCP server, read-only tools',
    'AtScale cloud or self-hosted',
    'SML is Apache 2.0; platform commercial',
  ],
  [
    'GoodData',
    'Logical data model per workspace; metrics in MAQL',
    'Optional: YAML via a beta VS Code extension and CLI',
    '23 sources, including ClickHouse',
    'Hierarchical workspaces with workspace data filters',
    'iframe, Web Components, React SDK; Python SDK',
    'MCP server (listed on the Enterprise plan)',
    'GoodData Cloud',
    'Commercial',
  ],
  [
    'Boring Semantic Layer',
    'Python models on Ibis',
    'Yes, if your app is Python',
    'Engines Ibis supports (DuckDB, Snowflake, BigQuery, PostgreSQL and more)',
    'Not covered in its docs',
    'Python API',
    'Built-in MCP server',
    'A library you run',
    'MIT',
  ],
];

const faqItems: FaqItem[] = [
  {
    question: 'What are the main alternatives to Cube?',
    answer:
      'The main Cube alternatives are the dbt Semantic Layer (MetricFlow) for teams already modelling in dbt, AtScale for Power BI and Excel users, GoodData for a hosted platform with embedding, Boring Semantic Layer for a lightweight Python library, and hypequery for ClickHouse teams who want typed metrics inside the application repo.',
  },
  {
    question: 'Is there an open-source alternative to Cube?',
    answer:
      'Cube Core itself is open source (Apache 2.0 backend, MIT client). Open-source alternatives include hypequery (Apache 2.0, ClickHouse only), Boring Semantic Layer (MIT, built on Ibis), MetricFlow (Apache 2.0, though the hosted dbt Semantic Layer APIs need a paid dbt plan) and AtScale’s SML modelling language (Apache 2.0).',
  },
  {
    question: 'Which Cube alternatives support ClickHouse?',
    answer:
      'Of the alternatives on this page, hypequery and GoodData document ClickHouse support. The dbt Semantic Layer and AtScale do not list ClickHouse. Boring Semantic Layer runs on engines Ibis supports, but its own docs do not name ClickHouse.',
  },
  {
    question: 'How much does Cube Cloud cost?',
    answer:
      'On cube.dev/pricing, checked November 12, 2026: Free is $0, Starter is $40 and Premium $80 per developer per month, and Enterprise is custom. Infrastructure is billed hourly on top, for example $0.60 an hour for a dedicated deployment on Starter. Embedded dashboards need Premium or higher; SSO needs Enterprise.',
  },
  {
    question: 'What is the difference between Cube and hypequery?',
    answer:
      'Cube is a service with its own APIs and caching that sits between many databases and many consumers, including BI tools. hypequery is a library for ClickHouse only: datasets are TypeScript or Python modules your app imports, so metric names are type-checked and tenant rules ship with the app.',
  },
];

const sources = [
  {
    vendor: 'Cube',
    urls: [
      'https://cube.dev/pricing',
      'https://cube.dev/articles/what-is-headless-bi',
      'https://github.com/cube-js/cube',
      'https://github.com/cube-js/cube/blob/master/docs-mintlify/embedding/multitenancy.mdx',
      'https://github.com/cube-js/cube/blob/master/docs-mintlify/embedding/index.mdx',
      'https://github.com/cube-js/cube/blob/master/docs-mintlify/docs/data-modeling/concepts/syntax.mdx',
      'https://github.com/cube-js/cube/blob/master/docs-mintlify/admin/connect-to-data/data-sources/clickhouse.mdx',
      'https://github.com/cube-js/cube/blob/master/docs-mintlify/docs/integrations/mcp-server.mdx',
      'https://github.com/cube-js/cube/blob/master/docs-mintlify/reference/core-data-apis/sql-api/index.mdx',
    ],
  },
  {
    vendor: 'Cube GitHub issues',
    urls: [
      'https://github.com/cube-js/cube/issues/8726',
      'https://github.com/cube-js/cube/issues/9892',
      'https://github.com/cube-js/cube/issues/9494',
      'https://github.com/cube-js/cube/issues/9074',
      'https://github.com/cube-js/cube/issues/10326',
    ],
  },
  {
    vendor: 'dbt Labs',
    urls: [
      'https://docs.getdbt.com/docs/use-dbt-semantic-layer/sl-faqs',
      'https://docs.getdbt.com/docs/dbt-cloud-apis/sl-api-overview',
      'https://www.getdbt.com/pricing',
      'https://github.com/dbt-labs/metricflow',
      'https://github.com/dbt-labs/dbt-mcp',
    ],
  },
  {
    vendor: 'AtScale',
    urls: [
      'https://www.atscale.com/integrations/',
      'https://www.atscale.com/use-cases/semantic-modeling/',
      'https://www.atscale.com/use-cases/semantic-context-ai-mcp/',
      'https://www.atscale.com/pricing/',
      'https://github.com/semanticdatalayer/sml',
    ],
  },
  {
    vendor: 'GoodData',
    urls: [
      'https://www.gooddata.com/pricing/',
      'https://www.gooddata.ai/docs/cloud/connect-data/',
      'https://www.gooddata.ai/docs/cloud/connect-data/create-data-sources/clickhouse/',
      'https://www.gooddata.ai/docs/cloud/create-metrics/maql/',
      'https://www.gooddata.ai/docs/cloud/workspaces/workspace-data-filters/',
      'https://www.gooddata.ai/docs/cloud/api-and-sdk/vs-code-extension/',
      'https://www.gooddata.ai/docs/cloud/ai/mcp-server/',
    ],
  },
  {
    vendor: 'Boring Semantic Layer',
    urls: [
      'https://github.com/boringdata/boring-semantic-layer',
      'https://github.com/boringdata/boring-semantic-layer/blob/main/docs/md/doc/mcp.md',
    ],
  },
];

const nextLinks: HubLink[] = [
  {
    href: '/compare/hypequery-vs-cube',
    title: 'hypequery vs Cube',
    description: 'The one-to-one comparison: setup, workflow, and where each is the right choice.',
  },
  {
    href: '/semantic-layer',
    title: 'What is a semantic layer?',
    description: 'Definitions, examples, and how dbt, Snowflake, Databricks and Cube compare.',
  },
  {
    href: '/compare/embedded-analytics-platforms',
    title: 'Embedded analytics platforms compared',
    description: 'Where headless semantic layers sit next to embedded BI and BI tools with embedding.',
  },
  {
    href: '/clickhouse-saas-analytics',
    title: 'Embedded analytics for SaaS on ClickHouse',
    description: 'How a code-first semantic layer powers in-app dashboards for each customer.',
  },
];

function Alternative({
  name,
  what,
  differs,
  bestFor,
}: {
  name: string;
  what: React.ReactNode;
  differs: React.ReactNode;
  bestFor: string;
}) {
  return (
    <article className={marketing.card}>
      <h3 className={marketing.cardTitle}>{name}</h3>
      <div className="mt-3 space-y-3 text-sm leading-6 text-text-muted">
        <p>{what}</p>
        <p>
          <strong className="text-text">How it differs from Cube:</strong> {differs}
        </p>
        <p>
          <strong className="text-text">Best for:</strong> {bestFor}
        </p>
      </div>
    </article>
  );
}

export default function CubeAlternativesPage() {
  return (
    <HubShell
      path={PATH}
      breadcrumbs={[
        { label: 'Home', href: '/' },
        { label: 'Compare', href: '/compare' },
        { label: 'Cube alternatives' },
      ]}
      eyebrow="Cube alternatives"
      title="5 Cube.js alternatives for semantic layers and embedded analytics"
      updated={UPDATED}
      lead={
        <p>
          Cube (formerly Cube.js) is still a strong choice when one semantic layer must serve many databases and clients.
          The best alternative depends on what you want to simplify: dbt Semantic Layer for teams already on dbt,
          AtScale for Power BI and Excel, GoodData for managed dashboards, Boring Semantic Layer for a small Python
          library, or hypequery for typed ClickHouse metrics inside the application repo.
        </p>
      }
      primaryCta={{ href: '#comparison', label: 'Compare all six', target: 'cube_alt_table' }}
      secondaryCta={{ href: '/compare/hypequery-vs-cube', label: 'hypequery vs Cube', target: 'cube_alt_vs' }}
      jsonLd={[
        techArticleJsonLd({ path: PATH, headline: TITLE, description: DESCRIPTION, datePublished: PUBLISHED, dateModified: UPDATED }),
        faqJsonLd(faqItems),
      ]}
    >
      <HubSection
        eyebrow="Credit where due"
        title="What Cube does well"
        intro={
          <>
            <p>
              Cube is the most widely adopted open-source semantic layer: about 21,200 stars on GitHub, and Cube Core is
              Apache 2.0. Models are YAML or JavaScript files that define measures, dimensions, joins and access rules
              once, and Cube serves them over REST, GraphQL and a SQL API that speaks the Postgres wire protocol, so BI
              tools that connect to Postgres can connect to Cube.
            </p>
            <p>
              Its data sources page lists 29 connectors (about 26 distinct engines, ClickHouse included). Pre-aggregations,
              built and refreshed by Cube and stored in Cube Store, make repeated dashboard queries cheap. Cube Cloud adds
              a hosted MCP server with 30 tools, analytics chat and agents, and all of that is on the free plan.
            </p>
          </>
        }
      />

      <HubSection
        band
        eyebrow="Why teams look elsewhere"
        title="Why teams consider a Cube alternative"
        intro={
          <p>
            Cube solves a broad problem, so it also brings more moving parts than a database-specific library. The
            trade-offs below come from Cube’s own docs, pricing page and public issue tracker; several of the linked
            ClickHouse issues have since been fixed.
          </p>
        }
      >
        <div className="grid gap-5 md:grid-cols-2">
          <div className={marketing.card}>
            <h3 className="text-[17px] font-medium tracking-tight text-text">Multi-tenancy has many moving parts</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              Cube’s{' '}
              <a href="https://github.com/cube-js/cube/blob/master/docs-mintlify/embedding/multitenancy.mdx" rel="noopener nofollow" className={extLink}>
                multitenancy docs
              </a>{' '}
              list up to nine options, from <code className={inlineCode}>contextToAppId</code> to{' '}
              <code className={inlineCode}>scheduledRefreshContexts</code>. The docs warn that{' '}
              <code className={inlineCode}>contextToAppId</code> alone isolates only model compilation, and that leaving{' '}
              <code className={inlineCode}>scheduledRefreshContexts</code> unset breaks background refresh. A{' '}
              <a href="https://github.com/cube-js/cube/issues/8726" rel="noopener nofollow" className={extLink}>
                2024 issue
              </a>{' '}
              reports per-tenant pre-aggregations that stop refreshing when tenants drop out of that list.
            </p>
          </div>
          <div className={marketing.card}>
            <h3 className="text-[17px] font-medium tracking-tight text-text">More services to run</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              Self-hosted Cube means API instances, a refresh worker, and Cube Store with a router and workers that
              persist to object storage. An{' '}
              <a href="https://github.com/cube-js/cube/issues/9892" rel="noopener nofollow" className={extLink}>
                open issue from 2025
              </a>{' '}
              asks how to split API and refresh-worker instances after hitting “No pre-aggregation partitions were built
              yet”. On Cube Cloud, those services are billed hourly on top of developer seats.
            </p>
          </div>
          <div className={marketing.card}>
            <h3 className="text-[17px] font-medium tracking-tight text-text">ClickHouse is one driver among many</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              Cube’s{' '}
              <a href="https://github.com/cube-js/cube/blob/master/docs-mintlify/admin/connect-to-data/data-sources/clickhouse.mdx" rel="noopener nofollow" className={extLink}>
                ClickHouse page
              </a>{' '}
              notes that pre-aggregations need indexes and export buckets must be S3. Recent issues covered booleans
              stored as integers in pre-aggregations (
              <a href="https://github.com/cube-js/cube/issues/9494" rel="noopener nofollow" className={extLink}>#9494</a>),
              replicated databases (
              <a href="https://github.com/cube-js/cube/issues/9074" rel="noopener nofollow" className={extLink}>#9074</a>,
              open about 21 months) and lost millisecond precision (
              <a href="https://github.com/cube-js/cube/issues/10326" rel="noopener nofollow" className={extLink}>#10326</a>).
              All three are now closed.
            </p>
          </div>
          <div className={marketing.card}>
            <h3 className="text-[17px] font-medium tracking-tight text-text">Embedding and SSO sit on higher plans</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              On{' '}
              <a href="https://cube.dev/pricing" rel="noopener nofollow" className={extLink}>
                Cube’s pricing page
              </a>
              , embedded dashboards and embedded chat start on Premium ($80 per developer per month), SAML SSO is
              Enterprise-only, and the DAX and MDX APIs need Enterprise plus the Performance M deployment tier.
            </p>
          </div>
        </div>
      </HubSection>

      <HubSection
        eyebrow="The alternatives"
        title="Five Cube alternatives, and how each differs"
      >
        <div className="grid gap-5 lg:grid-cols-2">
          <Alternative
            name="hypequery"
            what={
              <>
                An open-source (Apache 2.0) semantic layer for ClickHouse, written as TypeScript or Python datasets that
                live in your application repo. It serves them in-process, as HTTP endpoints with OpenAPI, as React hooks,
                and to agents through an MCP server. hypequery is our product.
              </>
            }
            differs="There is no separate service: the model is a module your backend imports. Metric names are type-checked, and the tenant key on a dataset makes un-scoped queries fail. It supports ClickHouse only, has no SQL API for BI tools, and has no pre-aggregation store of its own; it relies on ClickHouse materialized views and projections."
            bestFor="Product teams on ClickHouse building customer-facing dashboards, APIs and agent tools."
          />
          <Alternative
            name="dbt Semantic Layer (MetricFlow)"
            what="Metrics and semantic models defined in YAML next to your dbt models, compiled to SQL by MetricFlow and served through GraphQL, JDBC and a Python SDK."
            differs="It lives with your transformations rather than in a serving tier. The APIs need a paid dbt plan (Starter is $100 per user per month with 5,000 queried metrics), it supports six warehouses and not ClickHouse, and caching is an Enterprise feature."
            bestFor="Data teams already on dbt Cloud who want one set of metrics across BI tools."
          />
          <Alternative
            name="AtScale"
            what="A commercial semantic layer that computes metrics inside your data platform. Models are written in SML, an Apache 2.0 YAML language stored in Git."
            differs="AtScale speaks Power BI’s and Excel’s languages natively (DAX and MDX over XMLA) as well as a PostgreSQL interface. It lists no ClickHouse support, and pricing is by deployed semantic objects with no published figures."
            bestFor="Enterprises standardising Power BI and Excel on Snowflake, Databricks or BigQuery."
          />
          <Alternative
            name="GoodData"
            what="A hosted analytics platform with a logical data model per workspace, metrics in its own MAQL language, and embedding through iframes, Web Components or a React SDK."
            differs="GoodData includes the dashboards and the embedding, not only the semantic layer. Tenants map to hierarchical workspaces with data filters. It supports ClickHouse (tested against 25.1.4, without boolean columns). Prices are not published."
            bestFor="Teams who want a managed platform with dashboards and multi-tenancy built in."
          />
          <Alternative
            name="Boring Semantic Layer"
            what="A small MIT-licensed Python library built on Ibis, with a built-in MCP server. Version 0.3.19 was released on November 11, 2026."
            differs="It is a library, not a service, and it is young (about 490 GitHub stars, pre-1.0). It runs on any engine Ibis supports; its docs name DuckDB, Snowflake, BigQuery and PostgreSQL but not ClickHouse. There is no tenant model in its docs."
            bestFor="Python teams who want a lightweight semantic layer for notebooks and agents."
          />
        </div>
      </HubSection>

      <HubSection
        id="comparison"
        band
        eyebrow="Side by side"
        title="Cube alternatives compared"
        intro={<p>Checked against each vendor’s own docs, pricing page or repository on {VERIFIED_ON}.</p>}
      >
        <HubTable
          caption={`Cube and five alternatives compared, verified ${VERIFIED_ON}`}
          columns={[
            'Tool',
            'Model definition',
            'Lives in app repo?',
            'Databases',
            'Multi-tenancy',
            'APIs',
            'MCP and agents',
            'Hosting',
            'Licence',
          ]}
          rows={comparisonRows}
        />
        <p className="mt-4 text-xs leading-5 text-text-dim">Verified on {VERIFIED_ON}. hypequery is our product.</p>
      </HubSection>

      <HubSection
        eyebrow="Git-native"
        title="Where the model lives changes how drift is caught"
        intro={
          <>
            <p>
              Cube models, dbt YAML and AtScale SML are all files you can keep in Git, so “in version control” is not the
              difference. The difference is what checks them. A Cube model is configuration that the Cube service reads
              at runtime; the app that calls Cube’s API refers to measures by string, and a renamed measure surfaces as a
              failed request.
            </p>
            <p>
              A hypequery dataset is a module the app imports. Rename <code className={inlineCode}>revenue</code> and every
              caller that still asks for the old name fails the type check, in the same pull request that made the
              change.
            </p>
          </>
        }
      >
        <div className="max-w-[860px]">
          <CodeWindow code={driftCode} filename="drift.ts" />
        </div>
      </HubSection>

      <HubSection
        band
        eyebrow="Definition"
        title="Headless BI, in one paragraph"
        intro={
          <>
            <p>
              Headless BI separates the governed model from any one interface. In{' '}
              <a href="https://cube.dev/articles/what-is-headless-bi" rel="noopener nofollow" className={extLink}>
                Cube’s definition
              </a>
              , “metrics, dimensions, joins, and access rules live in a shared layer, while dashboards, embedded
              analytics, APIs, and AI agents query that same model.” Cube, hypequery and the dbt Semantic Layer are all
              headless in that sense; GoodData pairs its model with its own dashboards. The{' '}
              <Link href="/compare/embedded-analytics-platforms" className={inlineLink}>
                embedded analytics platforms comparison
              </Link>{' '}
              shows where headless layers sit next to embedded BI tools.
            </p>
          </>
        }
      />

      <HubSection
        eyebrow="Keep Cube when"
        title="When to stay on Cube"
        intro={
          <ul className="list-disc space-y-2 pl-5">
            <li>Your metrics span several databases, not only ClickHouse.</li>
            <li>
              Tableau, Power BI or Metabase must read the same metrics as your app, through Cube’s Postgres-compatible
              SQL API.
            </li>
            <li>Expensive queries hit by many users depend on pre-aggregations that Cube builds and refreshes for you.</li>
            <li>A data team owns metric definitions separately from the product engineers who use them.</li>
            <li>You want hosted analytics chat and agents without building them, which Cube Cloud includes from its free plan.</li>
          </ul>
        }
      />

      <HubSection band eyebrow="Questions" title="Cube alternatives FAQ">
        <HubFaq items={faqItems} />
      </HubSection>

      <HubSection eyebrow="Keep reading" title="Related comparisons and guides">
        <HubLinkGrid links={nextLinks} columns={2} />
      </HubSection>

      <HubSources checkedOn={VERIFIED_ON} sources={sources} />
    </HubShell>
  );
}
