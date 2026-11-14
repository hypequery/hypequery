import Link from 'next/link';
import type { ReactNode } from 'react';
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
import { faqJsonLd, type FaqItem } from '@/lib/structured-data';
import { updatedFor } from '@/data/page-dates';

const PATH = '/semantic-layer/open-source-tools';
const TITLE = 'Best Open-Source Semantic Layer Tools (2026): 8 Compared';
const DESCRIPTION =
  'Open-source semantic layers compared: Cube Core, Wren AI, Lightdash, MetricFlow, Malloy, hypequery and more, by licence, databases, ClickHouse support and MCP.';
const UPDATED = updatedFor(PATH);
// Every vendor claim was checked on the project's own repository, docs or package registry on this date.
// See seo-verification-log.md. Star counts drift; re-check them with the rest of the page.
const VERIFIED_ON = 'November 13, 2026';

export const metadata = spokeMetadata({ path: PATH, title: TITLE, description: DESCRIPTION });

const extLink = 'underline decoration-border-strong underline-offset-4 hover:text-accent';

const comparisonRows = [
  ['Cube Core', 'Apache 2.0 backend, MIT client', 'YAML or JavaScript model files', 'A service', 'Many, including ClickHouse', 'REST, GraphQL, SQL over the Postgres protocol', 'Hosted MCP server in Cube Cloud', '21.2k'],
  ['Wren AI', 'Apache 2.0 (docs CC BY 4.0)', 'MDL (Modeling Definition Language)', 'A service and CLI, on Apache DataFusion', '22+ connectors, including ClickHouse', 'Governed text-to-SQL, CLI', 'Included', '18.2k'],
  ['Lightdash', 'MIT, except the commercial ee/ directory', 'dbt YAML or standalone Lightdash YAML', 'A BI application', 'BigQuery, Snowflake, Redshift, Databricks, Postgres, Trino, ClickHouse and more', 'The Lightdash app', 'Lightdash Cloud, or self-hosted with an Enterprise licence', '6.2k'],
  ['dbt MetricFlow', 'Apache 2.0 (from v0.209.0)', 'YAML in a dbt project', 'A Python library and the mf CLI', 'Hosted Semantic Layer: Snowflake, BigQuery, Databricks, Redshift, Postgres, Trino', 'CLI locally; GraphQL, JDBC and Python SDK on paid dbt plans', 'dbt MCP server (Apache 2.0)', '1.9k'],
  ['Malloy', 'MIT', 'Malloy, a modelling and query language that compiles to SQL', 'A compiler, plus Malloy Publisher to serve models', 'BigQuery, Snowflake, DuckDB, MotherDuck, PostgreSQL, MySQL, Trino, Presto, Databricks', 'Malloy queries; REST through Publisher', 'Malloy Publisher (MIT)', '2.6k'],
  ['hypequery', 'Apache 2.0', 'TypeScript or Python modules (Python in beta)', 'A library inside your backend', 'ClickHouse only', 'In-process calls, HTTP with OpenAPI, React hooks', '@hypequery/mcp, no raw SQL tool', '105'],
  ['Boring Semantic Layer', 'MIT', 'Python models on Ibis', 'A Python library', 'Ibis backends such as DuckDB, Snowflake, BigQuery, PostgreSQL', 'Python API', 'Built in', '490'],
  ['AtScale SML', 'Apache 2.0 (the language only)', 'SML: YAML in Git', 'A model format; the AtScale engine is commercial', 'Through AtScale', 'Through AtScale', 'Through AtScale (read-only tools)', '179'],
];

type Tool = {
  name: string;
  href: string;
  what: ReactNode;
  strengths: string;
  limits: string;
  bestFor: string;
};

const tools: Tool[] = [
  {
    name: 'Cube Core',
    href: 'https://github.com/cube-js/cube',
    what: 'The most widely used open-source semantic layer. You define cubes, measures, dimensions and joins in YAML or JavaScript, and Cube serves them over REST, GraphQL and a SQL API that speaks the Postgres wire protocol, so Postgres-compatible BI tools can connect.',
    strengths: 'Many data sources including ClickHouse, three query APIs, and the largest community on this list.',
    limits: 'It is another service to deploy and run, and its MCP server is a Cube Cloud feature rather than part of Core.',
    bestFor: 'One model serving several databases and many consumers, including BI tools.',
  },
  {
    name: 'Wren AI',
    href: 'https://github.com/Canner/WrenAI',
    what: (
      <>
        Describes itself as a governed semantic layer expressed in MDL, its Modeling Definition Language, built on Apache
        DataFusion. The engine, which was a separate Wren Engine repository until May 2026, now lives in the WrenAI
        repository with a governed text-to-SQL service, an MCP server and a CLI.
      </>
    ),
    strengths: 'Built around natural-language questions and agents from the start; 22+ connectors, ClickHouse among them.',
    limits: 'The project is centred on text-to-SQL. Wren AI Cloud and Enterprise Plus are commercial, and the licence file reserves future modules for AGPL.',
    bestFor: 'Teams building a natural-language or agent interface over several databases.',
  },
  {
    name: 'Lightdash',
    href: 'https://github.com/lightdash/lightdash',
    what: 'A BI tool with a semantic layer. Metrics and dimensions are defined in your dbt project’s YAML or in standalone Lightdash YAML, and Lightdash builds charts and dashboards on top.',
    strengths: 'One place for the metric definitions and the dashboards that use them; ClickHouse is a supported adapter.',
    limits: 'It is a BI application rather than a layer other apps query. Code under ee/, including the MCP server, is under a commercial licence: MCP is on Lightdash Cloud, or self-hosted with an Enterprise licence.',
    bestFor: 'dbt teams who want open-source BI that reads their metric definitions.',
  },
  {
    name: 'dbt MetricFlow',
    href: 'https://github.com/dbt-labs/metricflow',
    what: (
      <>
        The engine behind the dbt Semantic Layer. It reads metrics defined in YAML in a dbt project and compiles metric
        requests into SQL. It moved to Apache 2.0 at version 0.209.0, after earlier AGPL and BSL releases. See the{' '}
        <Link href="/semantic-layer/dbt-metricflow" className={inlineLink}>
          dbt MetricFlow guide
        </Link>
        .
      </>
    ),
    strengths: 'Fits straight into an existing dbt project; you can define and query metrics locally with the mf CLI.',
    limits: 'Locally you get the CLI only: the APIs and integrations need a paid dbt plan, and the hosted Semantic Layer does not list ClickHouse.',
    bestFor: 'Analytics engineering teams already modelling in dbt on a supported warehouse.',
  },
  {
    name: 'Malloy',
    href: 'https://github.com/malloydata/malloy',
    what: 'A semantic modelling and query language built on SQL. You write models and queries in Malloy, and it compiles them to SQL for the engine you already run. Malloy Publisher serves models over REST and MCP.',
    strengths: 'A full modelling and query language rather than YAML plus an API, and it runs on the engine you already have.',
    limits: 'Readers have to learn a new language. ClickHouse is not among its supported engines.',
    bestFor: 'Analysts who want a modelling language that is more expressive than SQL.',
  },
  {
    name: 'hypequery',
    href: 'https://github.com/hypequery/hypequery',
    what: (
      <>
        Our project. Datasets with dimensions, measures, metrics and a tenant key are TypeScript or Python modules (Python
        in beta) that your application imports. The same definitions serve in-process queries, HTTP endpoints with
        OpenAPI, typed React hooks and an MCP server for agents. See the{' '}
        <Link href="/clickhouse-semantic-layer" className={inlineLink}>
          ClickHouse semantic layer
        </Link>{' '}
        page.
      </>
    ),
    strengths: 'Metric names are type-checked with the app, tenant scope fails closed, and the MCP server has no raw SQL tool.',
    limits: 'ClickHouse only, and it is a library, not a standalone service for BI tools. The hosted option is not live yet.',
    bestFor: 'Product teams on ClickHouse building customer-facing analytics, APIs or in-app agents.',
  },
  {
    name: 'Boring Semantic Layer',
    href: 'https://github.com/boringdata/boring-semantic-layer',
    what: 'A small Python semantic layer on Ibis, from boringdata and xorq-labs. Models are Python objects, and a built-in MCP server exposes them as tools.',
    strengths: 'Light to adopt in a Python or notebook workflow; runs on the engines Ibis supports. Version 0.3.19 shipped on November 11, 2026.',
    limits: 'Young and pre-1.0. Its docs do not name ClickHouse or cover per-user access rules.',
    bestFor: 'Python data teams who want metrics and an MCP server without a service.',
  },
  {
    name: 'AtScale SML',
    href: 'https://github.com/semanticdatalayer/SML',
    what: 'The Semantic Modeling Language: an Apache 2.0, YAML-based format for semantic models, kept in Git. It is the open part of AtScale; the engine that queries SML models is AtScale’s commercial platform.',
    strengths: 'An open, Git-friendly format for teams on AtScale, with versions up to 1.7.',
    limits: 'A model format, not a runnable semantic layer on its own.',
    bestFor: 'AtScale customers who want their models in an open format.',
  },
];

const faqItems: FaqItem[] = [
  {
    question: 'What is the best open-source semantic layer?',
    answer:
      'It depends on where your metrics need to go. Cube Core is the most widely used and serves many databases and BI tools. dbt MetricFlow suits teams already on dbt. Wren AI and Malloy suit natural-language and language-first workflows. hypequery suits ClickHouse product teams building customer-facing analytics and agents.',
  },
  {
    question: 'Is Cube open source?',
    answer:
      'Cube Core is: its backend is Apache 2.0 and its client libraries are MIT. Cube Cloud, which runs the hosted MCP server, is a commercial service.',
  },
  {
    question: 'Is the dbt Semantic Layer open source?',
    answer:
      'MetricFlow, the engine, is Apache 2.0 from version 0.209.0, and you can query metrics locally with its CLI. The hosted dbt Semantic Layer, with its GraphQL, JDBC and Python APIs and integrations, needs a dbt Starter, Enterprise or Enterprise+ plan.',
  },
  {
    question: 'Which open-source semantic layers support ClickHouse?',
    answer:
      'Of the tools on this page, Cube Core, Wren AI, Lightdash and hypequery document ClickHouse support. The hosted dbt Semantic Layer and Malloy do not list it, and Boring Semantic Layer’s docs do not name it.',
  },
  {
    question: 'Which open-source semantic layers have an MCP server for AI agents?',
    answer:
      'Wren AI, Malloy (through Malloy Publisher), Boring Semantic Layer and hypequery ship MCP servers under open-source licences. dbt’s MCP server is Apache 2.0, though its Semantic Layer tools need a paid plan. Cube’s MCP server is part of Cube Cloud, and Lightdash’s needs Lightdash Cloud or an Enterprise licence.',
  },
  {
    question: 'What is Apache Ossie (Open Semantic Interchange)?',
    answer:
      'Apache Ossie, formerly Open Semantic Interchange (OSI), is an Apache 2.0 specification for writing down semantic models so tools can exchange them. It is in the Apache Incubator. The latest released spec is 0.1.1, from December 2025. It is a format, not a semantic layer you can query.',
  },
];

const sources = [
  {
    vendor: 'Cube',
    urls: [
      'https://github.com/cube-js/cube',
      'https://github.com/cube-js/cube/blob/master/docs-mintlify/docs/data-modeling/concepts/syntax.mdx',
      'https://github.com/cube-js/cube/blob/master/docs-mintlify/reference/core-data-apis/sql-api/index.mdx',
      'https://github.com/cube-js/cube/blob/master/docs-mintlify/admin/connect-to-data/data-sources/clickhouse.mdx',
      'https://github.com/cube-js/cube/blob/master/docs-mintlify/docs/integrations/mcp-server.mdx',
    ],
  },
  {
    vendor: 'Wren AI',
    urls: ['https://github.com/Canner/WrenAI', 'https://github.com/Canner/WrenAI/blob/main/LICENSE', 'https://github.com/Canner/wren-engine'],
  },
  {
    vendor: 'Lightdash',
    urls: [
      'https://github.com/lightdash/lightdash',
      'https://github.com/lightdash/lightdash/blob/main/LICENSE',
      'https://docs.lightdash.com/references/integrations/lightdash-mcp',
    ],
  },
  {
    vendor: 'dbt Labs',
    urls: [
      'https://github.com/dbt-labs/metricflow',
      'https://docs.getdbt.com/docs/use-dbt-semantic-layer/sl-faqs',
      'https://github.com/dbt-labs/dbt-mcp',
    ],
  },
  {
    vendor: 'Malloy',
    urls: ['https://github.com/malloydata/malloy', 'https://github.com/malloydata/publisher'],
  },
  {
    vendor: 'Boring Semantic Layer',
    urls: [
      'https://github.com/boringdata/boring-semantic-layer',
      'https://github.com/boringdata/boring-semantic-layer/blob/main/docs/md/doc/query-agent-mcp.md',
      'https://pypi.org/project/boring-semantic-layer/',
    ],
  },
  {
    vendor: 'AtScale',
    urls: ['https://github.com/semanticdatalayer/SML', 'https://www.atscale.com/use-cases/semantic-context-ai-mcp/'],
  },
  {
    vendor: 'Apache Ossie',
    urls: ['https://github.com/apache/ossie', 'https://ossie.apache.org/'],
  },
];

function ToolCard({ tool, index }: { tool: Tool; index: number }) {
  return (
    <article className={marketing.card}>
      <h3 className={marketing.cardTitle}>
        {index + 1}.{' '}
        <a href={tool.href} rel="noopener nofollow" className={extLink}>
          {tool.name}
        </a>
      </h3>
      <div className="mt-3 space-y-3 text-sm leading-6 text-text-muted">
        <p>{tool.what}</p>
        <p>
          <strong className="text-text">Strengths:</strong> {tool.strengths}
        </p>
        <p>
          <strong className="text-text">Limits:</strong> {tool.limits}
        </p>
        <p>
          <strong className="text-text">Best for:</strong> {tool.bestFor}
        </p>
      </div>
    </article>
  );
}

export default function OpenSourceSemanticLayerToolsPage() {
  return (
    <HubShell
      path={PATH}
      breadcrumbs={spokeBreadcrumbs('Open-source tools')}
      eyebrow="Semantic layer"
      title="Open-source semantic layer tools, compared"
      updated={UPDATED}
      lead={
        <p>
          Eight open-source semantic layers and one open spec, compared by licence, how you write the model, which
          databases they reach, how you query them and whether AI agents can use them over MCP. Each claim was checked
          against the project&rsquo;s own repository or docs on {VERIFIED_ON}.
        </p>
      }
      primaryCta={{ href: '#comparison', label: 'Compare all eight', target: 'oss_sl_table' }}
      secondaryCta={{ href: '#choose', label: 'How to choose', target: 'oss_sl_choose' }}
      definition={{
        term: 'What counts as an open-source semantic layer?',
        body: (
          <>
            <p>
              A semantic layer is where metrics, dimensions and joins are defined once, so every dashboard, API and
              agent computes &ldquo;revenue&rdquo; the same way. For this page, an open-source semantic layer is one
              whose model format and query engine are published under an open-source licence, so you can run it
              yourself.
            </p>
            <p>
              Several projects are open at the core and commercial at the edges: hosted APIs, MCP servers or enterprise
              features. The table and the notes below say where that line falls for each one.
            </p>
          </>
        ),
      }}
      jsonLd={[spokeArticleJsonLd({ path: PATH, title: TITLE, description: DESCRIPTION, dateModified: UPDATED }), faqJsonLd(faqItems)]}
    >
      <HubSection
        id="comparison"
        eyebrow="At a glance"
        title="Open-source semantic layers compared"
        intro={<p>GitHub stars as of {VERIFIED_ON}, rounded.</p>}
      >
        <HubTable
          caption={`Open-source semantic layer tools compared, checked ${VERIFIED_ON}`}
          columns={['', 'Licence', 'You write', 'Runs as', 'Databases', 'Query with', 'MCP for agents', 'Stars']}
          rows={comparisonRows}
        />
      </HubSection>

      <HubSection band eyebrow="The tools" title="Eight open-source semantic layers">
        <div className="grid gap-5 lg:grid-cols-2">
          {tools.map((tool, index) => (
            <ToolCard key={tool.name} tool={tool} index={index} />
          ))}
        </div>
      </HubSection>

      <HubSection
        eyebrow="A spec, not a tool"
        title="Apache Ossie (Open Semantic Interchange)"
        intro={
          <p>
            Apache Ossie, formerly Open Semantic Interchange, is an Apache 2.0 specification for semantic models in YAML
            or JSON, so a model written for one tool can be read by another. It is incubating at the Apache Software
            Foundation, with Snowflake, dbt Labs, Salesforce, Databricks, Cube and others taking part. The latest
            released spec is 0.1.1, from December 2025. It describes models but does not query them, so it sits beside
            the tools above rather than replacing one. The{' '}
            <Link href="/semantic-layer/open-semantic-interchange" className={inlineLink}>
              Ossie guide
            </Link>{' '}
            covers what the spec includes.
          </p>
        }
      />

      <HubSection
        id="choose"
        band
        eyebrow="How to choose"
        title="Which open-source semantic layer fits"
        intro={
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong className="text-text">Many databases and BI tools on one model:</strong> Cube Core.
            </li>
            <li>
              <strong className="text-text">Already modelling in dbt:</strong> dbt MetricFlow, or Lightdash if you also
              want open-source dashboards.
            </li>
            <li>
              <strong className="text-text">Natural-language questions across several databases:</strong> Wren AI.
            </li>
            <li>
              <strong className="text-text">A richer language than SQL for analysts:</strong> Malloy.
            </li>
            <li>
              <strong className="text-text">Python notebooks and a quick MCP server:</strong> Boring Semantic Layer.
            </li>
            <li>
              <strong className="text-text">ClickHouse, inside your product, with agents:</strong> hypequery. See{' '}
              <Link href="/semantic-layer/ai-agents" className={inlineLink}>
                semantic layers for AI agents
              </Link>{' '}
              for what to check before connecting one.
            </li>
          </ul>
        }
      />

      <HubSection eyebrow="Questions" title="Open-source semantic layer FAQ">
        <HubFaq items={faqItems} />
      </HubSection>

      <SemanticLayerGuides currentHref={PATH} />
      <HubSources checkedOn={VERIFIED_ON} sources={sources} />
      <SemanticLayerNextStep location="oss_semantic_layer_next_step" />
    </HubShell>
  );
}
