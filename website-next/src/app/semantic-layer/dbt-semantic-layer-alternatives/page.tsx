import Link from 'next/link';
import { HubFaq, HubSection, HubShell, HubSources, HubTable } from '@/components/hub-page';
import {
  SemanticLayerGuides,
  SemanticLayerNextStep,
  inlineLink,
  spokeArticleJsonLd,
  spokeBreadcrumbs,
  spokeMetadata,
} from '@/components/semantic-layer-parts';
import { marketing } from '@/components/ui/marketing';
import { faqJsonLd, itemListJsonLd, type FaqItem } from '@/lib/structured-data';
import { updatedFor } from '@/data/page-dates';

const PATH = '/semantic-layer/dbt-semantic-layer-alternatives';
const TITLE = 'dbt Semantic Layer Alternatives (2026): 9 Options Compared';
const DESCRIPTION =
  'dbt Semantic Layer alternatives compared: Cube, hypequery, Lightdash, Wren AI, Malloy, AtScale and warehouse-native layers, by databases, APIs, MCP and licence.';
const UPDATED = updatedFor(PATH);
// Vendor claims were read on the vendor's own docs or repositories on these dates. See seo-verification-log.md.
const VERIFIED_ON = 'November 13 and 14, 2026';

export const metadata = spokeMetadata({ path: PATH, title: TITLE, description: DESCRIPTION });

type Option = {
  id: string;
  name: string;
  what: string;
  bestFor: string;
  watchOut: string;
};

const options: Option[] = [
  {
    id: 'cube',
    name: 'Cube',
    what: 'A standalone semantic layer service. Cube Core’s backend is Apache 2.0; models are YAML or JavaScript files. Serves REST, GraphQL and SQL over the Postgres wire protocol, and Cube Cloud adds a hosted MCP server on all plans.',
    bestFor: 'One model over several databases, feeding BI tools, applications and agents at once.',
    watchOut: 'Another service to run, or a Cube Cloud bill. Metrics move out of the dbt project into Cube’s model files.',
  },
  {
    id: 'hypequery',
    name: 'hypequery',
    what: 'A semantic layer defined in TypeScript or Python inside your application. Datasets, measures, relationships and a tenant key are code; the same definition serves a typed HTTP API, React hooks and an MCP server. Apache 2.0.',
    bestFor: 'ClickHouse, which the dbt Semantic Layer does not support, and analytics that live inside your product.',
    watchOut: 'ClickHouse only. No BI tool integrations, no dashboards. Python is in beta. Metrics live in the app repo, not the dbt project.',
  },
  {
    id: 'lightdash',
    name: 'Lightdash',
    what: 'An open-source BI tool that reads metrics from your dbt YAML, or from standalone Lightdash YAML. MIT, except an enterprise folder under a commercial licence. Adapters include ClickHouse.',
    bestFor: 'dbt teams that want BI on top of their existing YAML without moving definitions.',
    watchOut: 'It is a BI tool first. Its MCP server is on Lightdash Cloud; self-hosting it needs an Enterprise licence.',
  },
  {
    id: 'wren-ai',
    name: 'Wren AI',
    what: 'An open-source semantic layer and AI agent stack. Models are written in its Modeling Definition Language (MDL); built on Apache DataFusion; MCP server and CLI; 22+ connectors including ClickHouse. Code Apache 2.0.',
    bestFor: 'Text-to-SQL and chat over a governed model, on many databases.',
    watchOut: 'A separate modelling language from dbt. Cloud and Enterprise Plus editions are commercial.',
  },
  {
    id: 'boring-semantic-layer',
    name: 'Boring Semantic Layer',
    what: 'A small Python semantic layer built on Ibis, with a built-in MCP server. MIT.',
    bestFor: 'Python teams that want a lightweight model and agent access with little setup.',
    watchOut: 'Young project. Its docs do not name ClickHouse among tested backends.',
  },
  {
    id: 'malloy',
    name: 'Malloy',
    what: 'A semantic modelling and query language built on SQL. MIT. Malloy Publisher serves models over REST and MCP.',
    bestFor: 'Analysts who want a modelling language that composes better than SQL.',
    watchOut: 'A new language to learn. Engines include BigQuery, Snowflake, DuckDB, Postgres and others, but not ClickHouse.',
  },
  {
    id: 'atscale',
    name: 'AtScale',
    what: 'A commercial semantic layer for enterprise BI, with an open model format (SML, YAML, Apache 2.0) and a remote MCP server whose tools are read-only.',
    bestFor: 'Enterprises serving Excel and Power BI from Snowflake, Databricks or BigQuery.',
    watchOut: 'Commercial and enterprise-sized. Its integrations list does not include ClickHouse.',
  },
  {
    id: 'warehouse-native',
    name: 'Snowflake semantic views and Databricks metric views',
    what: 'Semantic models stored in the warehouse itself: CREATE SEMANTIC VIEW in Snowflake, Unity Catalog metric views in YAML on Databricks. Each has an agent on top (Cortex Analyst, Genie).',
    bestFor: 'Teams whose data, users and agents all live on one platform.',
    watchOut: 'Definitions do not travel to other platforms.',
  },
  {
    id: 'metricflow',
    name: 'MetricFlow on its own',
    what: 'The engine behind the dbt Semantic Layer is Apache 2.0. You can define metrics and query them locally with the mf CLI without a dbt platform plan.',
    bestFor: 'Keeping dbt metric YAML and generating SQL yourself.',
    watchOut: 'Without the paid platform there are no Semantic Layer APIs or integrations, so you build the serving layer.',
  },
];

const tableRows = [
  ['dbt Semantic Layer', 'YAML in the dbt project', 'Snowflake, BigQuery, Databricks, Redshift, Postgres, Trino', 'GraphQL, JDBC, Python SDK; BI integrations', 'dbt MCP server', 'Paid dbt plan (Starter and up)'],
  ['Cube', 'YAML or JavaScript', 'Many, including ClickHouse', 'REST, GraphQL, Postgres-wire SQL', 'Hosted, Cube Cloud', 'Core Apache 2.0; Cloud paid'],
  ['hypequery', 'TypeScript or Python', 'ClickHouse only', 'Typed HTTP API, React hooks, in-process calls', 'Built in, no SQL tool', 'Apache 2.0'],
  ['Lightdash', 'dbt YAML or Lightdash YAML', 'dbt adapters, including ClickHouse', 'BI UI', 'Lightdash Cloud; Enterprise to self-host', 'MIT, enterprise folder commercial'],
  ['Wren AI', 'MDL', '22+, including ClickHouse', 'CLI', 'Yes', 'Apache 2.0 code; Cloud commercial'],
  ['Boring Semantic Layer', 'Python', 'Ibis backends', 'Python', 'Built in', 'MIT'],
  ['Malloy', 'Malloy language', 'BigQuery, Snowflake, DuckDB, Postgres and more; no ClickHouse', 'Publisher REST', 'Publisher', 'MIT'],
  ['AtScale', 'SML (YAML)', 'Snowflake, Databricks, BigQuery, Redshift and more; no ClickHouse', 'BI tool integrations', 'Remote, read-only tools', 'Commercial; SML Apache 2.0'],
  ['Snowflake / Databricks', 'SQL DDL / YAML', 'Their own platform', 'Platform SQL and APIs', 'Platform agents and MCP', 'Platform pricing'],
];

const reasonsRows = [
  [
    'Your database is not supported',
    'The dbt Semantic Layer supports Snowflake, BigQuery, Databricks, Redshift, Postgres and Trino. ClickHouse, MySQL and others are not on the list.',
    'hypequery (ClickHouse), Cube, Wren AI, Lightdash',
  ],
  [
    'You need APIs without a paid plan',
    'MetricFlow is open source, but the Semantic Layer APIs and integrations need a dbt Starter, Enterprise or Enterprise+ plan. Caching and multiple credentials are Enterprise features.',
    'Cube Core, hypequery, Wren AI, Boring Semantic Layer',
  ],
  [
    'Metrics are served inside your product',
    'Customer-facing analytics needs tenant isolation and an API your app calls in-process or over HTTP. The dbt Semantic Layer applies the warehouse credentials mapped to each token, with no tenant rule in the model.',
    'hypequery, Cube',
  ],
  [
    'The consumers are agents',
    'You want an MCP server that only queries named metrics. The dbt MCP server includes SQL and CLI tools alongside its Semantic Layer tools; each can be switched off.',
    'hypequery, Cube, AtScale, Boring Semantic Layer',
  ],
  [
    'Everything is on one platform',
    'If all data and users are in Snowflake or Databricks, a semantic model stored in the warehouse removes a moving part.',
    'Snowflake semantic views, Databricks metric views',
  ],
];

const faqItems: FaqItem[] = [
  {
    question: 'What are the best alternatives to the dbt Semantic Layer?',
    answer:
      'It depends on why you are leaving. For ClickHouse, hypequery and Cube are the main options, since the dbt Semantic Layer does not support ClickHouse. For one model across many databases and BI tools, Cube. For BI on top of existing dbt YAML, Lightdash. For a single platform, Snowflake semantic views or Databricks metric views. For enterprise Excel and Power BI, AtScale.',
  },
  {
    question: 'Does the dbt Semantic Layer support ClickHouse?',
    answer:
      'No. dbt’s FAQ lists Snowflake, BigQuery, Databricks, Redshift, Postgres and Trino as the supported platforms, and says other platforms are not available at this time. You can still use dbt to transform data in ClickHouse; it is the Semantic Layer that is not supported.',
  },
  {
    question: 'Is there an open-source alternative to the dbt Semantic Layer?',
    answer:
      'Yes. Cube Core (Apache 2.0 backend), hypequery (Apache 2.0), Wren AI (Apache 2.0 code), Boring Semantic Layer (MIT), Malloy (MIT) and Lightdash (MIT apart from an enterprise folder) are all open source. MetricFlow itself is Apache 2.0, but the hosted Semantic Layer APIs are part of the paid dbt platform.',
  },
  {
    question: 'Does the dbt Semantic Layer have caching?',
    answer:
      'Yes, on Enterprise and Enterprise+ plans. dbt describes a result cache and a declarative cache, both stored in your data platform, and activated by client opt-in. Starter plans have the Semantic Layer without caching.',
  },
  {
    question: 'Can I keep dbt and use a different semantic layer?',
    answer:
      'Yes, and most teams do. dbt builds the tables; the semantic layer defines metrics over them. Lightdash reads metrics straight from dbt YAML; Cube, hypequery and the others query the tables dbt builds, so dbt keeps the transformation work.',
  },
  {
    question: 'How hard is it to move metrics off the dbt Semantic Layer?',
    answer:
      'The concepts map closely: semantic models become datasets or cubes, entities become joins, simple metrics become measures, ratio and derived metrics become formulas. The work is rewriting YAML in the new format and re-pointing every consumer at a new API. Conversion metrics usually have no direct equivalent.',
  },
];

const sources = [
  { vendor: 'dbt Labs', urls: ['https://docs.getdbt.com/docs/use-dbt-semantic-layer/sl-faqs', 'https://docs.getdbt.com/docs/dbt-cloud-apis/sl-api-overview', 'https://github.com/dbt-labs/metricflow', 'https://github.com/dbt-labs/dbt-mcp/blob/main/README.md'] },
  { vendor: 'Cube', urls: ['https://github.com/cube-js/cube', 'https://github.com/cube-js/cube/blob/master/docs-mintlify/docs/integrations/mcp-server.mdx', 'https://github.com/cube-js/cube/blob/master/docs-mintlify/reference/core-data-apis/sql-api/index.mdx'] },
  { vendor: 'hypequery', urls: ['https://github.com/hypequery/hypequery', 'https://hypequery.com/docs/datasets/overview'] },
  { vendor: 'Lightdash', urls: ['https://github.com/lightdash/lightdash/blob/main/LICENSE', 'https://docs.lightdash.com/references/integrations/lightdash-mcp'] },
  { vendor: 'Wren AI', urls: ['https://github.com/Canner/WrenAI/blob/main/README.md'] },
  { vendor: 'Boring Semantic Layer', urls: ['https://github.com/boringdata/boring-semantic-layer'] },
  { vendor: 'Malloy', urls: ['https://github.com/malloydata/malloy/blob/main/README.md', 'https://github.com/malloydata/publisher/blob/main/README.md'] },
  { vendor: 'AtScale', urls: ['https://github.com/semanticdatalayer/SML', 'https://www.atscale.com/integrations/', 'https://www.atscale.com/use-cases/semantic-context-ai-mcp/'] },
];

export default function DbtSemanticLayerAlternativesPage() {
  return (
    <HubShell
      path={PATH}
      breadcrumbs={spokeBreadcrumbs('dbt Semantic Layer alternatives')}
      eyebrow="Semantic layer"
      title="dbt Semantic Layer alternatives"
      updated={UPDATED}
      lead={
        <p>
          Nine options for teams that like defining metrics as code but need something the dbt Semantic Layer does not
          give them: a database it does not support, APIs without a paid plan, metrics served inside a product, or an
          agent that cannot write SQL.
        </p>
      }
      primaryCta={{ href: '#compare', label: 'Comparison table', target: 'dbt_alternatives_table' }}
      secondaryCta={{ href: '#why', label: 'Why teams switch', target: 'dbt_alternatives_why' }}
      definition={{
        term: 'What is the dbt Semantic Layer?',
        body: (
          <>
            <p>
              The dbt Semantic Layer lets you define semantic models and metrics in YAML inside a dbt project, and query
              them by name through GraphQL, JDBC and Python APIs and BI integrations. It is powered by MetricFlow, which
              is open source, while the hosted APIs are part of the paid dbt platform.
            </p>
            <p>
              An alternative replaces the metric definitions and the serving layer. It does not replace dbt itself:
              every option below can read tables that dbt builds.
            </p>
          </>
        ),
      }}
      jsonLd={[
        spokeArticleJsonLd({ path: PATH, title: TITLE, description: DESCRIPTION, dateModified: UPDATED }),
        itemListJsonLd('dbt Semantic Layer alternatives', options.map((option) => ({ name: option.name, url: `${PATH}#${option.id}` }))),
        faqJsonLd(faqItems),
      ]}
    >
      <HubSection id="why" eyebrow="Why teams look elsewhere" title="Five reasons to look beyond the dbt Semantic Layer">
        <HubTable
          caption="Reasons teams look for dbt Semantic Layer alternatives, and which options address each"
          columns={['Reason', 'Detail', 'Options to look at']}
          rows={reasonsRows}
        />
      </HubSection>

      <HubSection
        id="compare"
        band
        eyebrow="At a glance"
        title="The options side by side"
        intro={
          <p>
            Checked against each project&rsquo;s own docs, repository or pricing page on {VERIFIED_ON}. The dbt
            Semantic Layer is the first row, for reference.
          </p>
        }
      >
        <HubTable
          caption={`dbt Semantic Layer alternatives compared, checked ${VERIFIED_ON}`}
          columns={['', 'Model format', 'Databases', 'How apps query it', 'MCP for agents', 'Licence or plan']}
          rows={tableRows}
        />
      </HubSection>

      <HubSection id="options" eyebrow="The options" title="Nine alternatives, and who each suits">
        <div className="grid gap-5 md:grid-cols-2">
          {options.map((option) => (
            <div key={option.id} id={option.id} className={`${marketing.card} scroll-mt-24`}>
              <h3 className="text-[17px] font-medium tracking-tight text-text">{option.name}</h3>
              <p className="mt-3 text-sm leading-6 text-text-muted">{option.what}</p>
              <p className="mt-3 text-sm leading-6 text-text-muted">
                <strong className="text-text">Best for:</strong> {option.bestFor}
              </p>
              <p className="mt-2 text-sm leading-6 text-text-muted">
                <strong className="text-text">Watch out:</strong> {option.watchOut}
              </p>
            </div>
          ))}
        </div>
      </HubSection>

      <HubSection
        id="clickhouse"
        band
        eyebrow="On ClickHouse"
        title="If your metrics need to run on ClickHouse"
        intro={
          <>
            <p>
              This is the most common reason the dbt Semantic Layer is off the table: dbt can transform data in
              ClickHouse, but the Semantic Layer cannot query it. Your choices are a service that supports ClickHouse
              among many sources (Cube, Wren AI), BI on top of dbt YAML (Lightdash), or a layer built for ClickHouse.
            </p>
            <p>
              hypequery is the last kind. Datasets are TypeScript or Python files that point at the tables dbt builds;
              measures can use ClickHouse aggregates; a tenant key scopes every query; and the same definitions serve
              your API, React hooks and{' '}
              <Link href="/semantic-layer/analytics-mcp-server" className={inlineLink}>
                an MCP server with no SQL tool
              </Link>
              . The{' '}
              <Link href="/semantic-layer/dbt-metricflow" className={inlineLink}>
                dbt MetricFlow guide
              </Link>{' '}
              maps each MetricFlow concept to its hypequery equivalent.
            </p>
          </>
        }
      />

      <HubSection
        eyebrow="How to choose"
        title="A short decision path"
        intro={
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              Is your database on dbt&rsquo;s supported list, and are you on a paid plan? If yes, and your consumers are
              BI tools, the dbt Semantic Layer may be the least work. Stay.
            </li>
            <li>Is everything on one warehouse platform? Look at its native semantic model first.</li>
            <li>Do you need one model across many databases and BI tools? Cube.</li>
            <li>Do you mainly want BI over the dbt YAML you already have? Lightdash.</li>
            <li>
              Is the data in ClickHouse, and are the consumers your product and its agents? hypequery.
            </li>
            <li>Enterprise Excel and Power BI on Snowflake or Databricks? AtScale.</li>
          </ol>
        }
      />

      <HubSection band eyebrow="Questions" title="dbt Semantic Layer alternatives FAQ">
        <HubFaq items={faqItems} />
      </HubSection>

      <SemanticLayerGuides currentHref={PATH} />
      <HubSources checkedOn={VERIFIED_ON} sources={sources} />
      <SemanticLayerNextStep location="dbt_alternatives_next_step" />
    </HubShell>
  );
}
