import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Mount ClickHouse Analytics on an Express Server | hypequery',
  description:
    'Add a typed ClickHouse analytics surface to an existing Express app with Node handlers, request validation, and generated OpenAPI docs.',
  robots: {
    index: false,
    follow: true,
  },
  alternates: { canonical: absoluteUrl('/clickhouse-express') },
  openGraph: {
    type: 'website',
    url: absoluteUrl('/clickhouse-express'),
    title: 'Mount ClickHouse Analytics on an Express Server | hypequery',
    description:
      'Add a typed ClickHouse analytics surface to an existing Express app with Node handlers, request validation, and generated OpenAPI docs.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Mount ClickHouse Analytics on an Express Server | hypequery',
    description:
      'Add a typed ClickHouse analytics surface to an existing Express app with Node handlers, request validation, and generated OpenAPI docs.',
  },
};

const initServeCode = `import express from 'express';
import { initServe } from '@hypequery/serve';
import { z } from 'zod';
import { db } from '@/lib/clickhouse';
import { verifyJwt } from '@/lib/auth';

const { query, serve } = initServe({
  context: (req) => ({
    db,
    // Extract tenant from the verified JWT attached by auth middleware
    tenantId: (req as express.Request).tenant as string,
  }),
});

// Define analytics queries — each becomes a typed Express endpoint
export const revenueByDay = query({
  input: z.object({
    startDate: z.string(),
    endDate: z.string(),
  }),
  query: async ({ ctx, input }) =>
    ctx.db
      .table('orders')
      .select(['order_date', 'sum(total) as revenue', 'count() as order_count'])
      .where('tenant_id', 'eq', ctx.tenantId)
      .where('order_date', 'gte', input.startDate)
      .where('order_date', 'lte', input.endDate)
      .groupBy(['order_date'])
      .orderBy('order_date', 'ASC')
      .execute(),
});

export const topProducts = query({
  input: z.object({ limit: z.number().int().min(1).max(100).default(10) }),
  query: async ({ ctx, input }) =>
    ctx.db
      .table('order_items')
      .select(['product_id', 'product_name', 'sum(quantity) as units_sold'])
      .where('tenant_id', 'eq', ctx.tenantId)
      .groupBy(['product_id', 'product_name'])
      .orderBy('units_sold', 'DESC')
      .limit(input.limit)
      .execute(),
});

export const api = serve({ queries: { revenueByDay, topProducts } });`;

const fullServerCode = `import express from 'express';
import { createNodeHandler } from '@hypequery/serve';
import { api } from './analytics/queries';
import { verifyJwt } from './lib/auth';

const app = express();
app.use(express.json());

// Auth middleware — verify JWT and attach tenant to request
app.use('/analytics', async (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const payload = verifyJwt(token);
    (req as any).tenant = payload.tenantId;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Mount the generated handler under /analytics
app.use('/analytics', createNodeHandler(api.handler));

// OpenAPI spec and Swagger UI are generated automatically
// GET /analytics/openapi.json
// GET /analytics/docs

// Existing Express routes continue to work unchanged
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
  console.log('Analytics docs at http://localhost:3000/analytics/docs');
});`;

export default function ClickHouseExpressPage() {
  return (
    <ClickhousePillarPage
      eyebrow="ClickHouse Express"
      title="Mount typed ClickHouse analytics on your Express.js server"
      description="Most backend teams already have an Express.js server. Adding ClickHouse analytics means writing route handlers, request validation, auth extraction, and documentation. @hypequery/serve provides a framework-agnostic handler that you can mount in Express with the Node adapter — validated inputs, typed responses, and OpenAPI docs included."
      primaryCta={{ href: '/docs/quick-start', label: 'Get started' }}
      secondaryCta={{ href: '/clickhouse-rest-api', label: 'See the REST API guide' }}
      stats={[
        { label: 'Framework', value: 'Express.js' },
        { label: 'Package', value: '@hypequery/serve' },
        { label: 'Best for', value: 'Adding analytics to existing APIs' },
      ]}
      problems={[
        {
          title: 'Writing Express routes for ClickHouse means raw SQL and untyped responses',
          copy:
            'The standard path is: write a raw SQL query, call @clickhouse/client, cast the response to an interface you defined manually, then return it. Every analytics route in the codebase follows this pattern — and every one is slightly different.',
        },
        {
          title: 'Every analytics route reimplements the same auth and tenant extraction boilerplate',
          copy:
            'Each route reads the Authorization header, verifies the JWT, extracts the tenantId, and injects it into the WHERE clause. This is identical logic repeated across dozens of routes, and any change to the auth flow requires touching each one.',
        },
        {
          title: 'No documentation for ClickHouse Express routes means frontend teams guess response shapes',
          copy:
            "Without a schema or OpenAPI spec, the frontend team reads the Express source code to understand what each analytics endpoint returns. When a ClickHouse column changes, there's no warning — the frontend just breaks.",
        },
      ]}
      solutionSection={{
        eyebrow: 'How @hypequery/serve works with Express',
        title: 'Define analytics queries once — mount them on Express as typed endpoints',
        description:
          'initServe() takes a context factory that runs per-request. It reads tenant and auth information from the Express request and makes it available to every query. You define analytics queries with the query() function — each one gets Zod input validation and a typed ClickHouse query builder. Then you expose the resulting `api.handler` through `createNodeHandler()` and mount that in Express.',
        bullets: [
          'initServe() context factory runs per-request — reads JWT, session, or headers',
          'query() definitions include Zod input validation and typed ClickHouse queries',
          'createNodeHandler(api.handler) mounts the generated HTTP surface in Express',
          'OpenAPI spec generated automatically from input/output types',
          'Interactive Swagger UI available at /[prefix]/docs with no additional setup',
        ],
        codePanel: {
          eyebrow: 'Query definitions',
          title: 'Define analytics queries with initServe',
          description:
            "Context is injected per-request — the auth middleware sets req.tenant, and the context factory reads it. Every query definition has access to db and tenantId without re-implementing extraction logic.",
          code: initServeCode,
        },
      }}
      implementationSection={{
        eyebrow: 'Express integration',
        title: 'Mount analytics routes alongside your existing Express server',
        description:
          'createNodeHandler(api.handler) returns a Node-compatible request handler. You mount it on a path like /analytics alongside your existing routes. The analytics handler does not interfere with the rest of the Express app — it handles its own validation, error responses, and documentation.',
        paragraphs: [
          'Auth middleware runs before the analytics middleware and attaches tenant context to the request. The initServe() context factory reads that context and makes it available to all query definitions. One auth change propagates to every analytics endpoint.',
          'The generated OpenAPI spec is available at /analytics/openapi.json. Use it to generate TypeScript client types for your frontend, validate integration tests against the schema, or import it into API gateway tooling.',
        ],
        codePanel: {
          eyebrow: 'Express server',
          title: 'Full Express server with mounted analytics routes',
          description:
            'Existing routes are untouched. The analytics handler mounts on /analytics with auth applied upstream. OpenAPI docs are available immediately after startup.',
          code: fullServerCode,
        },
      }}
      searchIntentCards={[
        {
          title: 'ClickHouse Express.js TypeScript',
          copy:
            'Adding analytics to Express is mostly an integration problem: validation, auth context, response contracts, and documentation. The query definitions stay separate from the framework glue.',
        },
        {
          title: 'Express analytics API ClickHouse',
          copy:
            'A production Express analytics API needs consistent auth injection, input validation, and typed response schemas. The useful pattern is one named query definition per metric, not route logic scattered across handlers.',
        },
        {
          title: 'ClickHouse REST Express',
          copy:
            "If you're serving ClickHouse data from Express, the win is not avoiding all code. It is avoiding repeated boilerplate for validation, docs, and response typing around each analytics route.",
        },
        {
          title: 'Express ClickHouse query builder',
          copy:
            'The query builder is framework-agnostic, which is the important part. Express is just one host for the handler, not the place your ClickHouse query logic has to live forever.',
        },
      ]}
      readingLinks={[
        {
          href: '/clickhouse-nodejs',
          title: 'ClickHouse Node.js',
          description: 'Node.js-specific ClickHouse patterns — the foundation for Express integration.',
        },
        {
          href: '/clickhouse-rest-api',
          title: 'ClickHouse REST API',
          description: 'The complete guide to serving ClickHouse queries as typed REST endpoints.',
        },
        {
          href: '/clickhouse-openapi',
          title: 'ClickHouse OpenAPI',
          description: 'What the auto-generated OpenAPI spec covers and how to use it with frontend tooling.',
        },
        {
          href: '/clickhouse-typescript',
          title: 'ClickHouse TypeScript',
          description: 'Schema generation and the typed query builder that powers Express analytics routes.',
        },
      ]}
      relatedPillars={[
        { href: '/clickhouse-nodejs', label: 'ClickHouse Node.js' },
        { href: '/clickhouse-rest-api', label: 'ClickHouse REST API' },
        { href: '/clickhouse-openapi', label: 'ClickHouse OpenAPI' },
        { href: '/clickhouse-typescript', label: 'ClickHouse TypeScript' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Mount analytics on your Express server in under 30 minutes',
        description:
          'Install @hypequery/serve, generate your schema with the CLI, define your first analytics query, and mount it on your Express app. OpenAPI docs are available immediately — no extra configuration.',
        primaryCta: { href: '/docs/quick-start', label: 'Open the quick start' },
        secondaryCta: { href: '/clickhouse-openapi', label: 'See OpenAPI docs' },
      }}
    />
  );
}
