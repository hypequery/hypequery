import type { Metadata } from 'next';
import Link from 'next/link';
import { HubLanes, HubLinkGrid, HubSection, HubShell, type HubLink } from '@/components/hub-page';
import { marketing } from '@/components/ui/marketing';
import { absoluteUrl, ogImage } from '@/lib/site';
import { clickhouseFunctions, findFunction, functionPathSegment } from '@/data/clickhouse-functions';
import { hubs } from '@/data/hubs';

const PATH = '/clickhouse';
const TITLE = 'ClickHouse for TypeScript and Python Developers';
const DESCRIPTION =
  'Query ClickHouse from application code: TypeScript and Python guides, frameworks, SQL patterns, a function reference, APIs, and MCP for agents.';

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

const typescriptLane: HubLink[] = [
  {
    href: '/clickhouse-typescript',
    title: 'ClickHouse with TypeScript',
    description: 'Generate types from your live schema and build typed queries, APIs and hooks on them.',
  },
  {
    href: '/clickhouse-nodejs',
    title: 'ClickHouse with Node.js',
    description: 'Add ClickHouse to a Node.js backend you already run, such as Express or Nest.',
  },
  {
    href: '/clickhouse-js',
    title: 'ClickHouse with JavaScript',
    description: 'Use ClickHouse from JavaScript without raw query strings and hand-written row types.',
  },
  {
    href: '/clickhouse-query-builder',
    title: 'ClickHouse query builder',
    description: 'A schema-typed builder with joins, CTEs, PREWHERE and FINAL.',
  },
  {
    href: '/clickhouse-orm',
    title: 'ClickHouse ORM',
    description: 'An ORM-style workflow for ClickHouse: generated types, then typed queries and APIs.',
  },
  {
    href: '/clickhouse-schema',
    title: 'ClickHouse schema types',
    description: 'Map ClickHouse column types to TypeScript, including the 64-bit and Decimal edge cases.',
  },
  {
    href: '/clickhouse-nextjs',
    title: 'ClickHouse with Next.js',
    description: 'Run typed queries in route handlers and server components.',
  },
  {
    href: '/clickhouse-react',
    title: 'ClickHouse with React',
    description: 'Typed hooks over an analytics API, built on TanStack Query.',
  },
];

const pythonLane: HubLink[] = [
  {
    href: '/clickhouse-python',
    title: 'ClickHouse with Python',
    description: 'Define measures, dimensions and tenant rules once in Python and query them by name.',
  },
  {
    href: '/clickhouse-pandas',
    title: 'ClickHouse with pandas',
    description: 'Pull ClickHouse measures into pandas from the same definitions your product uses.',
  },
  {
    href: '/clickhouse-sqlalchemy',
    title: 'ClickHouse with SQLAlchemy',
    description: 'SQLAlchemy for ad hoc SQL, hypequery for shared, tenant-scoped measures.',
  },
  {
    href: '/clickhouse-fastapi',
    title: 'ClickHouse with FastAPI',
    description: 'Authenticated, tenant-scoped endpoints with request validation and rate limiting.',
  },
  {
    href: '/clickhouse-django',
    title: 'ClickHouse with Django',
    description: 'Call shared measures from views and tasks, and keep the Django ORM for transactional data.',
  },
  {
    href: '/clickhouse-flask',
    title: 'ClickHouse with Flask',
    description: 'Serve ClickHouse analytics from Flask with measures defined once in Python.',
  },
  {
    href: '/docs/python/datasets/chdb',
    title: 'Embedded ClickHouse with chDB',
    description: 'Run Python datasets on chDB, in process, for tests, CI and local development.',
  },
  {
    href: '/fastapi-react-analytics',
    title: 'FastAPI and React analytics',
    description: 'Serve Python datasets from FastAPI and get typed React hooks from the same definitions.',
  },
];

const sqlGuides: HubLink[] = [
  {
    href: '/blog/a-guide-to-materialized-views-in-clickhouse',
    title: 'Materialized views',
    description: 'Why ClickHouse materialized views are insert triggers, not cached results, and how to use them.',
  },
  {
    href: '/blog/clickhouse-prewhere-vs-where',
    title: 'PREWHERE vs WHERE',
    description: 'When moving a filter into PREWHERE cuts the data ClickHouse reads, and when it does not.',
  },
  {
    href: '/blog/clickhouse-final-replacingmergetree-typescript',
    title: 'FINAL and ReplacingMergeTree',
    description: 'Duplicate rows stay visible until a merge. FINAL, argMax and LIMIT BY compared.',
  },
  {
    href: '/blog/clickhouse-pagination-typescript',
    title: 'Pagination',
    description: 'Offset, cursor and keyset pagination patterns and their costs.',
  },
  {
    href: '/blog/clickhouse-limit-by-typescript',
    title: 'LIMIT BY',
    description: 'Top N rows per group in one pass, without a window function.',
  },
  {
    href: '/blog/clickhouse-window-functions-typescript',
    title: 'Window functions',
    description: 'row_number, rank, dense_rank and lagInFrame in ClickHouse.',
  },
  {
    href: '/blog/clickhouse-date-functions-typescript',
    title: 'Date functions',
    description: 'toStartOfDay, toStartOfQuarter and friends for time bucketing.',
  },
  {
    href: '/blog/clickhouse-tostartofinterval-typescript',
    title: 'toStartOfInterval with GROUP BY',
    description: 'Fixed-size time buckets such as 5 or 15 minutes for charts.',
  },
  {
    href: '/blog/clickhouse-group-by-typescript',
    title: 'GROUP BY and aggregations',
    description: 'Aggregate functions and grouping patterns, with typed results.',
  },
  {
    href: '/blog/clickhouse-joins-typescript',
    title: 'JOIN types',
    description: 'LEFT, RIGHT, INNER and ARRAY JOIN, with performance notes.',
  },
  {
    href: '/blog/clickhouse-asof-join-typescript',
    title: 'ASOF JOIN',
    description: 'Match each row to the closest earlier row, such as trades to quotes.',
  },
  {
    href: '/blog/clickhouse-cte-typescript',
    title: 'CTEs',
    description: 'How WITH clauses behave in ClickHouse (inlined, not materialized).',
  },
];

const servingLinks: HubLink[] = [
  {
    href: '/clickhouse-api',
    title: 'ClickHouse REST API',
    description: 'Turn typed queries into validated HTTP endpoints with request and response schemas.',
  },
  {
    href: '/clickhouse-openapi',
    title: 'ClickHouse OpenAPI',
    description: 'Generate an OpenAPI spec from the same query definitions.',
  },
  {
    href: '/clickhouse-mcp',
    title: 'ClickHouse MCP server',
    description: 'Give AI agents governed tools over your datasets instead of raw SQL.',
  },
  {
    href: '/clickhouse-python-mcp',
    title: 'ClickHouse MCP from Python',
    description: 'Give MCP clients your Python datasets. Python keeps the SQL, auth and tenant.',
  },
  {
    href: '/clickhouse-ai-sdk',
    title: 'ClickHouse + Vercel AI SDK',
    description: 'Analytics chat with streamText: tenant-safe tools, no text-to-SQL.',
  },
  {
    href: '/clickhouse-ai-agents',
    title: 'ClickHouse AI agents',
    description: 'Agentic analytics with the AI SDK, the Anthropic SDK or the OpenAI Agents SDK.',
  },
];

const comparisonLinks: HubLink[] = [
  {
    href: '/compare/hypequery-vs-clickhouse-client',
    title: 'hypequery vs @clickhouse/client',
    description: 'The official Node.js client compared with a typed layer on top of it.',
  },
  {
    href: '/compare/hypequery-vs-clickhouse-connect',
    title: 'hypequery vs clickhouse-connect',
    description: 'The official Python driver compared with a semantic layer.',
  },
  {
    href: '/compare/hypequery-vs-kysely',
    title: 'hypequery vs Kysely',
    description: 'Two different bets on type safety, and where ClickHouse changes the tradeoffs.',
  },
  {
    href: '/compare',
    title: 'All comparisons',
    description: 'Drizzle, Prisma, Cube, Tinybird, dbt and more, side by side.',
  },
];

// Functions people look up most often. The full list lives on the reference index.
const FEATURED_FUNCTIONS = ['toStartOfInterval', 'sumIf', 'multiIf', 'formatDateTime', 'quantile', 'uniq'];

const featuredFunctions = FEATURED_FUNCTIONS.map((name) => findFunction(name)).filter(
  (fn): fn is NonNullable<typeof fn> => Boolean(fn),
);

const collectionJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'CollectionPage',
  name: TITLE,
  description: DESCRIPTION,
  url: absoluteUrl(PATH).toString(),
  hasPart: [...typescriptLane, ...pythonLane, ...sqlGuides, ...servingLinks].map((link) => ({
    '@type': 'WebPage',
    name: link.title,
    url: absoluteUrl(link.href).toString(),
  })),
};

const inlineLink = 'font-medium text-text underline decoration-border-strong underline-offset-4 transition hover:text-accent hover:decoration-accent';

export default function ClickHouseHubPage() {
  return (
    <HubShell
      path={PATH}
      breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'ClickHouse' }]}
      eyebrow="ClickHouse developer hub"
      title="ClickHouse for TypeScript and Python developers"
      lead={
        <p>
          Guides for querying ClickHouse from application code: picking a client, typing results, writing the SQL
          patterns ClickHouse rewards, and serving the results to dashboards, APIs and AI agents.
        </p>
      }
      primaryCta={{ href: '/docs/quick-start', label: 'TypeScript quick start', target: 'docs_quick_start' }}
      secondaryCta={{ href: '/docs/quick-start#python', label: 'Python quick start', target: 'docs_python_quick_start' }}
      definition={{
        term: 'What does using ClickHouse from application code involve?',
        body: (
          <>
            <p>
              ClickHouse is an open-source, column-oriented database built for analytical queries over large tables.
              Calling it from a backend means three jobs on top of the driver: keeping result types in step with the
              schema, writing queries that suit a columnar engine (sorting keys, PREWHERE, pre-aggregation), and putting
              a safe interface in front of it for the dashboards, APIs and agents that consume the numbers.
            </p>
            <p>
              hypequery is an open-source library for those jobs. In TypeScript it adds a query builder typed from your
              schema. In TypeScript and Python (beta) it adds{' '}
              <Link href={hubs.semanticLayer.href} className={inlineLink}>
                datasets
              </Link>
              , a semantic layer you serve over HTTP, React hooks and MCP.
            </p>
          </>
        ),
      }}
      jsonLd={[collectionJsonLd]}
    >
      <HubSection
        eyebrow="Pick your language"
        title="Two lanes: TypeScript and Python"
        intro={
          <p>
            Both SDKs read the same ClickHouse tables and implement the same dataset and Serve protocol, so a Python
            backend and a TypeScript frontend can share one definition of a metric. The TypeScript SDK also includes a
            typed query builder; the Python SDK works at the dataset level.
          </p>
        }
      >
        <HubLanes
          lanes={[
            {
              title: 'TypeScript and JavaScript',
              intro: 'Node.js backends, Next.js apps and React dashboards.',
              links: typescriptLane,
            },
            {
              title: 'Python (beta)',
              intro: 'FastAPI, Django and Flask backends, notebooks and DataFrames.',
              links: pythonLane,
            },
          ]}
        />
      </HubSection>

      <HubSection
        band
        eyebrow="ClickHouse SQL guides"
        title="Query patterns that suit a columnar engine"
        intro={
          <p>
            ClickHouse rewards queries that read few columns and few granules. These guides cover the clauses and
            functions that come up once a ClickHouse table backs a real feature, each with SQL and a typed TypeScript
            version.
          </p>
        }
      >
        <HubLinkGrid links={sqlGuides} />
      </HubSection>

      <HubSection
        eyebrow="Function reference"
        title="ClickHouse functions with examples"
        intro={
          <p>
            The{' '}
            <Link href="/clickhouse/functions" className={inlineLink}>
              ClickHouse function reference
            </Link>{' '}
            covers {clickhouseFunctions.length} common functions for dates, aggregates, strings, conditionals, math and
            arrays. Each page has the signature, the return type, a SQL example and a typed query-builder example.
          </p>
        }
      >
        <div className="flex flex-wrap gap-3">
          {featuredFunctions.map((fn) => (
            <Link
              key={fn.slug}
              href={`/clickhouse/functions/${functionPathSegment(fn.name)}`}
              className="rounded-md border border-border bg-bg-card px-4 py-2 font-mono text-sm text-accent transition hover:border-border-strong hover:bg-bg-alt"
            >
              {fn.name}()
            </Link>
          ))}
          <Link
            href="/clickhouse/functions"
            className="rounded-md px-4 py-2 text-sm font-medium text-text transition hover:text-accent"
          >
            All functions <span aria-hidden="true">→</span>
          </Link>
        </div>
      </HubSection>

      <HubSection
        band
        eyebrow="Serve the results"
        title="APIs, OpenAPI and MCP for agents"
        intro={
          <p>
            Once a query is right, other code needs to call it. These pages cover turning queries into HTTP endpoints
            with schemas, and giving AI agents tools over governed datasets rather than a SQL connection.
          </p>
        }
      >
        <HubLinkGrid links={servingLinks} columns={2} />
      </HubSection>

      <HubSection
        eyebrow="Choosing tools"
        title="Compare ClickHouse clients and layers"
        intro={
          <p>
            If you are still choosing a stack, these comparisons cover the official drivers, general SQL builders and
            hosted platforms.
          </p>
        }
      >
        <HubLinkGrid links={comparisonLinks} columns={2} />
      </HubSection>

      <HubSection
        band
        eyebrow="Related hubs"
        title="Building analytics features on ClickHouse"
        intro={
          <p>
            Two topics come up as soon as ClickHouse powers a product feature: defining metrics once, and showing them to
            customers safely.
          </p>
        }
      >
        <HubLinkGrid
          columns={2}
          links={[
            {
              href: hubs.semanticLayer.href,
              title: 'ClickHouse semantic layer',
              description: 'Define measures, dimensions, tenant keys and time keys once, in TypeScript or Python.',
            },
            {
              href: hubs.embeddedAnalytics.href,
              title: 'Embedded analytics',
              description: 'Customer-facing dashboards on ClickHouse: build vs buy, tenant isolation and vendors.',
            },
          ]}
        />
      </HubSection>

      <section className={`${marketing.container} py-16 text-center`}>
        <h2 className={`mx-auto max-w-[760px] text-balance ${marketing.sectionTitle}`}>Run one typed query against your own schema</h2>
        <p className="mx-auto mt-3.5 max-w-[560px] text-body text-pretty text-text-muted">
          The CLI reads your ClickHouse schema and writes the types. Open source, and it runs in your own backend.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/docs/quick-start"
            data-umami-event="cta_click"
            data-umami-event-target="docs_quick_start"
            data-umami-event-location="hub_footer_primary"
            className={marketing.primaryButton}
          >
            Get started <span aria-hidden="true">→</span>
          </Link>
          <Link href="/docs" className={marketing.secondaryButton}>
            Read the docs
          </Link>
        </div>
      </section>
    </HubShell>
  );
}
