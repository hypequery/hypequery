import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'ClickHouse for Node.js Scripts, Jobs, and APIs | hypequery',
  description:
    'Use ClickHouse from Node.js scripts, jobs, and servers without rebuilding row types and HTTP wiring around every query.',
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
      description="This page is narrower than the JavaScript page. It is about the backend reality: scripts, workers, Express servers, and the point where a query needs to become a reusable API instead of another helper buried in a service file."
      primaryCta={{ href: '/docs/quick-start', label: 'Start with hypequery' }}
      secondaryCta={{ href: '/clickhouse-rest-api', label: 'See the REST API' }}
      stats={[
        { label: 'Runtime', value: 'Node.js and Bun' },
        { label: 'Frameworks', value: 'Express, Next.js, custom Node servers' },
        { label: 'Type source', value: 'Generated from schema' },
      ]}
      problems={[
        {
          title: 'Node services accumulate query helpers fast',
          copy:
            'A server codebase rarely has just one query caller. Jobs, workers, route handlers, and admin tasks all want the same data, and each one tends to grow its own helper if there is no shared path.',
        },
        {
          title: 'The HTTP layer keeps getting rebuilt',
          copy:
            'Once a query needs an endpoint, teams start writing validation, auth handling, error shaping, and docs around it. That is a lot of repeated backend work for what should still be one analytics query.',
        },
        {
          title: 'Type mismatches hide inside server code',
          copy:
            'Node developers often spot the runtime mismatch later because the wrong shape is hidden inside service code and only surfaces after it has already passed through several layers.',
        },
      ]}
      solutionSection={{
        eyebrow: 'Setup',
        title: 'Start with a typed backend query layer, not another helper module',
        description:
          'Generate the schema once, initialize the builder in your backend, and make that the standard way Node code reaches ClickHouse. That gives scripts, workers, and services the same typed starting point.',
        bullets: [
          'Works well in Node.js services, scripts, and Bun runtimes',
          'Schema types generated from your live ClickHouse instance',
          'Correct ClickHouse-to-Node.js type mappings — no guessing',
          'Composable query builder with support for typed filters, joins, CTEs, and raw SQL when needed',
          'Optional HTTP serving layer via @hypequery/serve handlers',
        ],
        codePanel: {
          eyebrow: 'Setup',
          title: 'A backend entry point you can reuse across services and jobs',
          description:
            'The point of this setup is consistency. Once the builder exists in one standard place, the rest of the Node codebase stops reinventing how it talks to ClickHouse.',
          code: setupCode,
        },
      }}
      implementationSection={{
        eyebrow: 'With Express',
        title: 'Promote a query into an endpoint without burying logic in the route',
        description:
          'When Node code needs to expose analytics over HTTP, keep the query definition separate from the web framework and mount the handler around it. That keeps the route thin and the analytics logic reusable.',
        paragraphs: [
          'That separation is what makes the Node page distinct from the framework pages. The query can still run directly inside a job or script, and only becomes an HTTP concern when you actually need a server surface.',
          'If your app is specifically App Router-first, use the Next.js page. This page is for the general backend case where Express-style or standalone Node runtimes are still the center of gravity.',
        ],
        codePanel: {
          eyebrow: 'Express integration',
          title: 'A thin Express mount around a shared analytics definition',
          description:
            'The useful part is not the middleware line by itself. It is that the route is no longer where the analytics logic lives.',
          code: expressCode,
        },
      }}
      searchIntentCards={[
        {
          title: 'What this page is really for',
          copy:
            'It is for backend teams whose main concern is service code, jobs, and server routes, not client hooks or App Router rendering.',
        },
        {
          title: 'Where Node teams usually feel pain',
          copy:
            'Usually when the same query appears in a worker, a route, and a report generator and every copy evolves separately.',
        },
        {
          title: 'Why the server layer matters',
          copy:
            'Backend teams end up paying for every decision twice if query logic and route logic are fused together. This page is about keeping them separate.',
        },
        {
          title: 'Where to branch next',
          copy:
            'Use the Next.js page for App Router specifics and the REST page if the endpoint layer itself is your main concern.',
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
        title: 'Replace one backend query path end to end',
        description:
          'Pick one script, worker, or route that currently owns its own ClickHouse query code, move it onto the shared builder, and then decide whether it also deserves a served API surface.',
        primaryCta: { href: '/docs/quick-start', label: 'Start with hypequery' },
        secondaryCta: { href: '/clickhouse-rest-api', label: 'See the REST API guide' },
      }}
    />
  );
}
