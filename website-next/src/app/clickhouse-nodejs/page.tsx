import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'ClickHouse for Node.js Scripts, Jobs, and APIs | hypequery',
  description:
    'Query ClickHouse from Node.js with schema-generated types, reusable analytics code, and one path that works across scripts, workers, and HTTP servers.',
  alternates: { canonical: absoluteUrl('/clickhouse-nodejs') },
  openGraph: {
    type: 'website',
    url: absoluteUrl('/clickhouse-nodejs'),
    title: 'ClickHouse for Node.js Scripts, Jobs, and APIs | hypequery',
    description:
      'Query ClickHouse from Node.js with schema-generated types, reusable analytics code, and one path that works across scripts, workers, and HTTP servers.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClickHouse for Node.js Scripts, Jobs, and APIs | hypequery',
    description:
      'Query ClickHouse from Node.js with schema-generated types, reusable analytics code, and one path that works across scripts, workers, and HTTP servers.',
  },
};

const setupCode = `import { createQueryBuilder } from '@hypequery/clickhouse';
import type { DB } from './schema'; // generated from your ClickHouse schema

const db = createQueryBuilder<DB>({
  host: process.env.CLICKHOUSE_HOST!,
  port: 8123,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: 'analytics',
});

// db is fully typed — autocomplete on table names and column names`;

const expressCode = `import express from 'express';
import { createNodeHandler, initServe } from '@hypequery/serve';
import { z } from 'zod';

const app = express();

const { query, serve } = initServe({
  context: (req) => ({ db, userId: req.user?.id }),
});

const pageViews = query({
  input: z.object({ from: z.string(), to: z.string() }),
  query: async ({ ctx, input }) =>
    ctx.db
      .table('events')
      .where('event_name', 'eq', 'page_view')
      .where('created_at', 'gte', input.from)
      .where('created_at', 'lte', input.to)
      .groupBy(['page'])
      .count('id', 'views')
      .orderBy('views', 'DESC')
      .execute(),
});

const api = serve({ queries: { pageViews } });
app.use('/analytics', createNodeHandler(api.handler));`;

export default function ClickHouseNodejsPage() {
  return (
    <ClickhousePillarPage
      eyebrow="ClickHouse Node.js"
      title="Use ClickHouse from Node.js without hand-maintained query types"
      description="Most Node.js teams do not need an abstract database platform. They need a reliable way to query ClickHouse from scripts, API servers, jobs, and dashboards without retyping result shapes by hand. hypequery gives that Node.js workflow a typed center of gravity."
      primaryCta={{ href: '/docs/quick-start', label: 'Get started' }}
      secondaryCta={{ href: '/clickhouse-rest-api', label: 'See the REST API' }}
      stats={[
        { label: 'Runtime', value: 'Node.js and Bun' },
        { label: 'Frameworks', value: 'Express, Next.js, custom Node servers' },
        { label: 'Type source', value: 'Generated from schema' },
      ]}
      problems={[
        {
          title: '@clickhouse/client returns untyped results in Node.js',
          copy:
            'The official Node.js ClickHouse client runs queries and returns any. Every response requires a manual type cast to an interface you hand-wrote and have to maintain as the schema changes.',
        },
        {
          title: 'Building a Node.js analytics API from scratch is slow',
          copy:
            'Once you need to expose ClickHouse data over HTTP in Node.js, you write server routes with validation, error handling, auth, and response typing. That layer is not trivial and it is not your core product.',
        },
        {
          title: 'ClickHouse type mappings trip up Node.js developers',
          copy:
            'Node.js developers familiar with Postgres expect Date objects and numbers from a database query. ClickHouse returns DateTime as a formatted string and UInt64 as a string. Silent bugs follow.',
        },
      ]}
      solutionSection={{
        eyebrow: 'Setup',
          title: 'A typed Node.js query layer for ClickHouse in minutes',
        description:
          'Run schema generation to get a typed DB interface from your live ClickHouse database. Pass it to createQueryBuilder() and you have a fully typed query builder — autocomplete on table names, column names, and return values across your Node.js codebase.',
        bullets: [
          'Works well in Node.js services, scripts, and Bun runtimes',
          'Schema types generated from your live ClickHouse instance',
          'Correct ClickHouse-to-Node.js type mappings — no guessing',
          'Composable query builder with support for typed filters, joins, CTEs, and raw SQL when needed',
          'Optional HTTP serving layer via @hypequery/serve handlers',
        ],
        codePanel: {
          eyebrow: 'Setup',
          title: 'Typed ClickHouse client for Node.js',
          description:
            'Import the generated DB type and pass it to createQueryBuilder(). From that point every query is fully typed — table names autocomplete, column names autocomplete, and return types are inferred from the schema.',
          code: setupCode,
        },
      }}
      implementationSection={{
        eyebrow: 'With Express',
        title: 'Mount typed ClickHouse analytics on any Node.js server',
        description:
          'If you are building an analytics API on top of ClickHouse in Node.js, @hypequery/serve handles the HTTP layer. Define your queries, pass them to serve(), and mount `api.handler` through the Node adapter in Express or another Node server.',
        paragraphs: [
          'The Node adapter is the stable integration point for Express-style servers. For fetch-based runtimes such as Next.js App Router route handlers, Cloudflare Workers, or Deno, the fetch adapter is the right fit.',
          'For standalone scripts and jobs, skip serve() entirely and call .execute() directly. The query builder works the same way regardless of context.',
        ],
        codePanel: {
          eyebrow: 'Express integration',
          title: 'Typed analytics endpoints on Express',
          description:
            'Define your analytics queries and mount them through createNodeHandler(api.handler). Input validation, typed responses, and OpenAPI docs are all handled by hypequery.',
          code: expressCode,
        },
      }}
      searchIntentCards={[
        {
          title: 'ClickHouse Node.js client TypeScript',
          copy:
            'The official client gets data in and out. The harder Node.js problem is reusing those queries across scripts, jobs, servers, and dashboards without rewriting types around each call site.',
        },
        {
          title: 'ClickHouse Node.js query builder',
          copy:
            'A useful Node.js query builder for ClickHouse should give you typed composition for the common path and a raw SQL escape hatch for the clauses that still need it.',
        },
        {
          title: 'ClickHouse Express.js API',
          copy:
            'If those same Node.js queries later need an API surface, the serve layer can expose them without pushing the query logic into Express-specific files.',
        },
        {
          title: 'ClickHouse Node HTTP adapter',
          copy:
            'The HTTP adapter matters because it keeps the query layer separate from the web framework. That separation is what lets the same analytics code serve scripts, jobs, and endpoints.',
        },
      ]}
      readingLinks={[
        {
          href: '/clickhouse-js',
          title: 'ClickHouse JavaScript',
          description: 'The broader JavaScript and TypeScript guide — the same patterns in a framework-agnostic context.',
        },
        {
          href: '/clickhouse-nextjs',
          title: 'ClickHouse Next.js',
          description: 'Integrating ClickHouse into Next.js App Router — server components and API routes.',
        },
        {
          href: '/clickhouse-rest-api',
          title: 'ClickHouse REST API',
          description: 'Full guide to serving typed ClickHouse queries as HTTP endpoints with @hypequery/serve.',
        },
        {
          href: '/clickhouse-typescript',
          title: 'ClickHouse TypeScript',
          description: 'The full TypeScript workflow — schema types, typed queries, HTTP APIs, and React hooks.',
        },
      ]}
      relatedPillars={[
        { href: '/clickhouse-js', label: 'ClickHouse JavaScript' },
        { href: '/clickhouse-typescript', label: 'ClickHouse TypeScript' },
        { href: '/clickhouse-nextjs', label: 'ClickHouse Next.js' },
        { href: '/clickhouse-rest-api', label: 'ClickHouse REST API' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Add hypequery to your Node.js project',
        description:
          'Install the package, run schema generation, and write your first typed ClickHouse query in Node.js. Works with any Node.js framework or runtime.',
        primaryCta: { href: '/docs/quick-start', label: 'Open quick start' },
        secondaryCta: { href: '/clickhouse-rest-api', label: 'See the REST API guide' },
      }}
    />
  );
}
