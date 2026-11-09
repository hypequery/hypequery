import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl, ogImage } from '@/lib/site';

export const metadata: Metadata = {
  title: 'ClickHouse API: HTTP Interface vs a Typed REST API Layer',
  description:
    'ClickHouse has an HTTP API on ports 8123 and 8443 for raw SQL. For an app-facing REST API with auth, validation and OpenAPI docs, build it from typed queries.',
  alternates: { canonical: absoluteUrl('/clickhouse-api') },
  openGraph: {
    images: ogImage('ClickHouse API in TypeScript'),
    type: 'website',
    url: absoluteUrl('/clickhouse-api'),
    title: 'ClickHouse API: HTTP Interface vs a Typed REST API Layer | hypequery',
    description:
      'ClickHouse has an HTTP API on ports 8123 and 8443 for raw SQL. For an app-facing REST API with auth, validation and OpenAPI docs, build it from typed queries.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClickHouse API: HTTP Interface vs a Typed REST API Layer | hypequery',
    description:
      'Raw SQL over ClickHouse\'s HTTP API, or an app-facing REST API with auth, validation and OpenAPI docs built from typed queries.',
  },
};

const defineCode = `import { initServe } from '@hypequery/serve';
import { z } from 'zod';
import { verifyAuth } from './auth'; // your session or JWT check

const { query, serve } = initServe({
  context: () => ({ db }),
});

export const activeUsers = query({
  input: z.object({
    from: z.string(),
    to: z.string(),
  }),
  query: ({ ctx, input }) =>
    ctx.db
      .table('events')
      .where('created_at', 'gte', input.from)
      .where('created_at', 'lte', input.to)
      .countDistinct('user_id', 'active_users')
      .execute(),
});

export const api = serve({
  // The tenant comes from the verified session, and every query is scoped to it
  auth: verifyAuth,
  tenant: {
    extract: (auth) => auth.tenantId,
    column: 'tenant_id',
    mode: 'auto-inject',
  },
  queries: { activeUsers },
});`;

const serveCode = `const api = serve({
  queries: { activeUsers, revenueByDay, topPages },
});

// POST /activeUsers
// body: { from: "2026-04-01", to: "2026-04-30" }
// response typed from the ClickHouse query

// GET /openapi.json
// GET /docs`;

export default function ClickHouseApiPage() {
  return (
    <ClickhousePillarPage
      eyebrow="ClickHouse API"
      title="Build a ClickHouse API from typed query definitions"
      description="The hard part of building a ClickHouse API is not opening an HTTP port. It is keeping request validation, auth, response shapes, and query logic from turning into four separate layers of code. hypequery keeps those concerns attached to the same query definition."
      primaryCta={{ href: '/docs/quick-start', label: 'Start with hypequery' }}
      secondaryCta={{ href: '/clickhouse-openapi', label: 'Generate OpenAPI docs' }}
      stats={[
        { label: 'Package', value: '@hypequery/serve' },
        { label: 'Docs generation', value: 'Automatic OpenAPI' },
        { label: 'Best fit', value: 'Analytics APIs and product backends' },
      ]}
      problems={[
        {
          title: 'A raw ClickHouse client is not an API layer',
          copy:
            'The official client runs queries, but you still have to design request validation, auth, response shapes, and endpoint contracts yourself. That is where most ClickHouse API work actually goes.',
        },
        {
          title: 'Hand-written route handlers duplicate query logic',
          copy:
            'Teams often copy the same analytics query into Express routes, Next.js handlers, and internal services. Every change becomes a multi-file refactor with more room for drift.',
        },
        {
          title: 'Frontend and integration teams need a stable contract',
          copy:
            'A usable ClickHouse API is not just SQL over HTTP. Consumers need typed inputs, typed outputs, and documentation they can rely on without reverse-engineering network traffic.',
        },
      ]}
      solutionSection={{
        eyebrow: 'How it works',
        title: 'Define the query once and expose it as an endpoint',
        description:
          'hypequery lets you define a query once, type it from the live ClickHouse schema, validate inputs with Zod, and expose the same contract over HTTP with OpenAPI docs. That is the shortest path from ClickHouse query logic to a real API.',
        bullets: [
          'Query definitions become typed API endpoints',
          'Inputs validated with Zod before the query runs',
          'Response types inferred from the ClickHouse schema',
          'Auth and tenant context injected per request',
          'OpenAPI spec and Swagger UI generated automatically',
        ],
        codePanel: {
          eyebrow: 'Step 1',
          title: 'Define the query contract',
          description:
            'The query definition is the contract. Once it exists, you can run it locally or expose it over HTTP without rewriting the logic.',
          code: defineCode,
        },
      }}
      implementationSection={{
        eyebrow: 'Step 2',
        title: 'Serve the same contract as a ClickHouse API',
        description:
          'Pass your query definitions to serve() and each query becomes a validated endpoint. OpenAPI output is generated from the same contract, so the docs stay aligned with the implementation.',
        paragraphs: [
          'This is the main difference from ad hoc route handlers. The query stays first-class instead of being hidden inside a controller.',
          'If your team needs dashboards, internal tools, or product features on top of ClickHouse, this keeps the data contract consistent across all of them.',
        ],
        codePanel: {
          eyebrow: 'Step 2',
          title: 'Expose the API endpoints',
          description:
            'No hand-written route per query. The API surface comes from the query definitions you already reviewed and typed.',
          code: serveCode,
        },
      }}
      searchIntentCards={[
        {
          title: 'What is the ClickHouse API?',
          copy:
            'ClickHouse\'s own API is its HTTP interface: send SQL to port 8123, or 8443 with TLS, for example `curl \'https://play.clickhouse.com/?user=play\' --data-binary \'SELECT 1\'`. It runs whatever SQL it receives, so it is the transport, not an app-facing API. For that you need validation, auth context and typed responses on top, which hypequery generates from query definitions.',
        },
        {
          title: 'API for ClickHouse in TypeScript',
          copy:
            'If you are building a ClickHouse API in TypeScript, the shortest path is a typed query layer plus automatic serving and OpenAPI generation rather than hand-writing every route.',
        },
        {
          title: 'How do I build an API layer on top of ClickHouse?',
          copy:
            'Define the query once, type it from the live schema, then expose it over HTTP. That is the layer @hypequery/serve is designed to provide.',
        },
        {
          title: 'ClickHouse API with OpenAPI docs',
          copy:
            'OpenAPI generation is part of the workflow, not an afterthought. The same contract that defines the query also defines the API docs.',
        },
      ]}
      readingLinks={[
        {
          href: '/clickhouse-openapi',
          title: 'ClickHouse OpenAPI generation',
          description: 'See how the OpenAPI spec is generated from your query contracts and how consumers can use it.',
        },
        {
          href: '/clickhouse-query-builder',
          title: 'ClickHouse Query Builder',
          description: 'The query-definition layer that sits underneath the API endpoints and keeps the logic reusable.',
        },
        {
          href: '/clickhouse-nextjs',
          title: 'ClickHouse Next.js',
          description: 'Use the same typed query contracts inside App Router handlers and server-side application code.',
        },
        {
          href: '/blog/typed-rest-api-clickhouse',
          title: 'How to Expose ClickHouse Queries as a Typed REST API',
          description: 'Build a ClickHouse REST API in TypeScript. Define a query once with zod-validated input, serve it over HTTP with generated OpenAPI docs, attach auth, and call it in-process — step by step with @hypequery/serve.',
        },
      ]}
      relatedPillars={[
        { href: '/clickhouse-openapi', label: 'ClickHouse OpenAPI' },
        { href: '/clickhouse-query-builder', label: 'ClickHouse Query Builder' },
        { href: '/clickhouse-typescript', label: 'ClickHouse TypeScript' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Start with hypequery and expose your first ClickHouse API endpoint',
        description:
          'Generate schema types, define one real query, and serve it as a validated endpoint. That is the fastest way to prove the ClickHouse API workflow on your own schema.',
        primaryCta: { href: '/docs/quick-start', label: 'Start with hypequery' },
        secondaryCta: { href: '/clickhouse-openapi', label: 'Generate OpenAPI docs' },
      }}
    />
  );
}
