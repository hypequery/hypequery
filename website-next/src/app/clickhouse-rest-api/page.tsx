import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'ClickHouse API in TypeScript — Typed REST Endpoints | hypequery',
  description:
    'Build a ClickHouse API in TypeScript without hand-writing every route. hypequery turns query definitions into typed REST endpoints with OpenAPI docs and input validation.',
  alternates: { canonical: absoluteUrl('/clickhouse-rest-api') },
  openGraph: {
    type: 'website',
    url: absoluteUrl('/clickhouse-rest-api'),
    title: 'ClickHouse API in TypeScript — Typed REST Endpoints | hypequery',
    description:
      'Define your ClickHouse analytics queries once. Serve them as typed API endpoints with OpenAPI docs and no hand-written route per query.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClickHouse API in TypeScript | hypequery',
    description:
      'Build a ClickHouse API in TypeScript from typed query definitions. OpenAPI docs and validated inputs included.',
  },
};

const defineCode = `import { initServe } from '@hypequery/serve';
import { z } from 'zod';

const { query, serve } = initServe({
  context: (req) => ({
    db,
    tenantId: req.headers['x-tenant-id'] as string,
  }),
});

// define your analytics query once
export const revenueByDay = query({
  input: z.object({
    from: z.string(),
    to: z.string(),
  }),
  query: async ({ ctx, input }) =>
    ctx.db
      .table('orders')
      .where('tenant_id', 'eq', ctx.tenantId)
      .where('created_at', 'gte', input.from)
      .where('created_at', 'lte', input.to)
      .groupBy(['order_date'])
      .sum('total', 'revenue')
      .execute(),
});`;

const serveCode = `// serve all queries as typed REST endpoints
const app = serve({
  queries: { revenueByDay, activeUsers, topProducts },
});

app.listen(3000);

// POST /revenueByDay
// body: { from: "2026-01-01", to: "2026-04-25" }
// response: { data: { order_date: string; revenue: string }[] }

// GET /openapi.json — auto-generated OpenAPI spec
// GET /docs — interactive Swagger UI`;

export default function ClickHouseRestApiPage() {
  return (
    <ClickhousePillarPage
      eyebrow="ClickHouse REST API"
      title="Build a ClickHouse API from typed query definitions"
      description="The hard part of building a ClickHouse API is not opening an HTTP port. It is keeping validation, auth, response shapes, and query logic from drifting apart. @hypequery/serve solves that by turning one query definition into a typed API endpoint."
      primaryCta={{ href: '/docs/quick-start', label: 'Start with hypequery' }}
      secondaryCta={{ href: '/clickhouse-openapi', label: 'Generate OpenAPI docs' }}
      stats={[
        { label: 'Package', value: '@hypequery/serve' },
        { label: 'Docs generation', value: 'Automatic OpenAPI' },
        { label: 'Best for', value: 'Analytics APIs and dashboards' },
      ]}
      problems={[
        {
          title: 'Every team rebuilds the same ClickHouse HTTP layer',
          copy:
            'Once analytics queries need to be consumed by a frontend, a mobile app, or another service, someone ends up writing API routes. That means validation, error handling, auth, and response typing. Most teams rebuild that layer from scratch.',
        },
        {
          title: 'Query logic gets duplicated across routes',
          copy:
            'The same ClickHouse query ends up in a Next.js route, a cron job, a dashboard API, and an export endpoint — each with slightly different filtering. When the query logic needs to change, it changes everywhere inconsistently.',
        },
        {
          title: 'No OpenAPI docs means dashboard teams have to guess the shape',
          copy:
            'Without a schema for your analytics API, frontend developers have to inspect network requests or ask the backend team about response shapes. Every change to a ClickHouse query potentially breaks consumers silently.',
        },
      ]}
      solutionSection={{
        eyebrow: 'How @hypequery/serve works',
        title: 'Define queries once, serve them as typed HTTP endpoints',
        description:
          'You define analytics queries using the hypequery query builder. @hypequery/serve wraps those definitions in endpoints with Zod input validation, typed responses, auth context injection, and automatic OpenAPI spec generation.',
        bullets: [
          'Query definitions become POST endpoints with validated request bodies',
          'Response types inferred from ClickHouse schema — no annotation needed',
          'Auth and tenant context injected per-request from headers or session',
          'OpenAPI spec generated automatically from query input/output types',
          'Interactive Swagger UI available at /docs out of the box',
        ],
        codePanel: {
          eyebrow: 'Step 1',
          title: 'Define your analytics query',
          description:
            'The query definition includes input validation (Zod), context injection for auth and tenancy, and the typed ClickHouse query. This same definition runs inline or over HTTP.',
          code: defineCode,
        },
      }}
      implementationSection={{
        eyebrow: 'Step 2',
        title: 'One line to serve all queries as REST endpoints',
        description:
          'Pass your query definitions to serve() and get a production-ready HTTP server. Each query becomes an endpoint, OpenAPI docs are generated automatically, and the response types match the ClickHouse schema.',
        paragraphs: [
          'The same query definition that runs inline in a script or cron job becomes an API endpoint without duplication. If the query changes, it changes in one place.',
          'If you want the shortest proof, define one real query and expose it. The generated OpenAPI output is then a by-product of the same contract rather than a second task.',
        ],
        codePanel: {
          eyebrow: 'Step 2',
          title: 'Serve all queries — OpenAPI included',
          description:
            'Every query definition becomes a typed POST endpoint. The OpenAPI spec and Swagger UI are available immediately — no manual documentation step.',
          code: serveCode,
        },
      }}
      searchIntentCards={[
        {
          title: 'ClickHouse API TypeScript',
          copy:
            'Building a typed ClickHouse API in TypeScript is exactly what @hypequery/serve handles. Define your analytics queries once and serve them as REST endpoints with validated inputs and typed responses.',
        },
        {
          title: 'ClickHouse API server Node.js',
          copy:
            '@hypequery/serve runs in Node.js and can be mounted through its Node adapter or used as a standalone handler. Your ClickHouse queries become API endpoints without writing route handlers manually.',
        },
        {
          title: 'ClickHouse analytics API with auth',
          copy:
            'The context function in initServe() injects per-request auth and tenancy — read from headers, JWTs, or session data. Every query in the serve() call has access to the typed context, including tenant isolation.',
        },
        {
          title: 'ClickHouse REST endpoint from query definition',
          copy:
            'Instead of writing an Express route that calls ClickHouse and returns a response, you define the query once with hypequery and pass it to serve(). The endpoint comes from the query definition instead of re-implementing it.',
        },
      ]}
      readingLinks={[
        {
          href: '/clickhouse-openapi',
          title: 'ClickHouse OpenAPI generation',
          description: 'What the auto-generated OpenAPI spec looks like and how to use it with frontend clients.',
        },
        {
          href: '/clickhouse-api',
          title: 'ClickHouse API',
          description: 'The direct intent page for teams searching for how to build or expose a ClickHouse API.',
        },
        {
          href: '/clickhouse-query-builder',
          title: 'ClickHouse Query Builder',
          description: 'The query definition layer that @hypequery/serve wraps into HTTP endpoints.',
        },
        {
          href: '/clickhouse-react',
          title: 'ClickHouse React',
          description: 'Consume your typed REST endpoints as React hooks for dashboard and UI components.',
        },
        {
          href: '/clickhouse-multi-tenant-analytics',
          title: 'Multi-tenant analytics',
          description: 'How to inject tenant context and enforce row-level isolation across all REST endpoints.',
        },
      ]}
      relatedPillars={[
        { href: '/clickhouse-openapi', label: 'ClickHouse OpenAPI' },
        { href: '/clickhouse-query-builder', label: 'ClickHouse Query Builder' },
        { href: '/clickhouse-react', label: 'ClickHouse React' },
        { href: '/clickhouse-nextjs', label: 'ClickHouse Next.js' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Start with hypequery and serve your first ClickHouse API endpoint',
        description:
          'Install @hypequery/serve, define a query, and expose it as a typed API endpoint. The OpenAPI spec is generated automatically from the same contract.',
        primaryCta: { href: '/docs/quick-start', label: 'Start with hypequery' },
        secondaryCta: { href: '/clickhouse-openapi', label: 'Generate OpenAPI docs' },
      }}
    />
  );
}
