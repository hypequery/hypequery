import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'ClickHouse Hono Routes with Typed Query Results | hypequery',
  description:
    'Use Hono as the HTTP layer and hypequery as the ClickHouse query layer for typed analytics routes on Node.js or fetch-based runtimes.',
  robots: {
    index: false,
    follow: true,
  },
  alternates: { canonical: absoluteUrl('/clickhouse-hono') },
  openGraph: {
    type: 'website',
    url: absoluteUrl('/clickhouse-hono'),
    title: 'ClickHouse Hono Routes with Typed Query Results | hypequery',
    description:
      'Use Hono as the HTTP layer and hypequery as the ClickHouse query layer for typed analytics routes on Node.js or fetch-based runtimes.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClickHouse Hono Routes with Typed Query Results | hypequery',
    description:
      'Use Hono as the HTTP layer and hypequery as the ClickHouse query layer for typed analytics routes on Node.js or fetch-based runtimes.',
  },
};

const honoRouteCode = `import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { db } from '@/lib/clickhouse';

const app = new Hono<{ Variables: { tenantId: string } }>();

// Auth middleware — extract tenant from JWT or header
app.use('/analytics/*', async (c, next) => {
  const tenantId = c.req.header('x-tenant-id') ?? '';
  c.set('tenantId', tenantId);
  await next();
});

app.get(
  '/analytics/revenue',
  zValidator(
    'query',
    z.object({ startDate: z.string(), endDate: z.string() }),
  ),
  async (c) => {
    const { startDate, endDate } = c.req.valid('query');
    const tenantId = c.get('tenantId');

    const rows = await db
      .table('orders')
      .select(['order_date', 'sum(total) as revenue'])
      .where('tenant_id', 'eq', tenantId)
      .where('order_date', 'gte', startDate)
      .where('order_date', 'lte', endDate)
      .groupBy(['order_date'])
      .orderBy('order_date', 'ASC')
      .execute();

    // rows is typed: { order_date: string; revenue: string }[]
    return c.json({ data: rows });
  },
);

export default app;`;

const honoRpcCode = `// server/app.ts — Hono app with typed RPC routes
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { db } from '@/lib/clickhouse';

const analyticsRoutes = new Hono()
  .get(
    '/active-users',
    zValidator('query', z.object({ windowDays: z.coerce.number().min(1).max(90) })),
    async (c) => {
      const { windowDays } = c.req.valid('query');
      const tenantId = c.req.header('x-tenant-id') ?? '';
      const start = new Date(Date.now() - windowDays * 86_400_000)
        .toISOString()
        .replace('T', ' ')
        .slice(0, 19);

      const rows = await db
        .table('events')
        .select(['toStartOfDay(timestamp) as day', 'uniq(user_id) as users'])
        .where('tenant_id', 'eq', tenantId)
        .where('timestamp', 'gte', start)
        .groupBy(['day'])
        .execute();

      return c.json({ data: rows });
    },
  )
  .get('/top-events', zValidator('query', z.object({ limit: z.coerce.number().default(10) })), async (c) => {
    const { limit } = c.req.valid('query');
    const tenantId = c.req.header('x-tenant-id') ?? '';

    const rows = await db
      .table('events')
      .select(['event_name', 'count() as occurrences'])
      .where('tenant_id', 'eq', tenantId)
      .groupBy(['event_name'])
      .orderBy('occurrences', 'DESC')
      .limit(limit)
      .execute();

    return c.json({ data: rows });
  });

export const app = new Hono().route('/analytics', analyticsRoutes);
export type AppType = typeof app;

// client.ts — typed Hono RPC client
import { hc } from 'hono/client';
import type { AppType } from './server/app';

const client = hc<AppType>('https://api.example.com');

// Fully typed — response shape inferred from the route handler
const { data } = await client.analytics['active-users'].$get({
  query: { windowDays: 30 },
}).then((r) => r.json());

// data is typed: { day: string; users: string }[]`;

export default function ClickHouseHonoPage() {
  return (
    <ClickhousePillarPage
      eyebrow="ClickHouse Hono"
      title="Build ClickHouse analytics APIs with Hono and hypequery"
      description="Hono is a fast, lightweight web framework that runs on Node.js, Cloudflare Workers, Deno, and Bun. hypequery gives Hono routes a typed ClickHouse data layer. The combination means you can build analytics APIs where the response shape is inferred all the way from the ClickHouse column definition to the browser client."
      primaryCta={{ href: '/docs/quick-start', label: 'Get started' }}
      secondaryCta={{ href: '/clickhouse-rest-api', label: 'See the REST API guide' }}
      stats={[
        { label: 'Framework', value: 'Hono' },
        { label: 'Runtime', value: 'Node.js, Edge, Bun, Deno' },
        { label: 'Best for', value: 'Fetch-based analytics APIs' },
      ]}
      problems={[
        {
          title: 'Hono has no built-in ClickHouse integration — raw queries lose types immediately',
          copy:
            "Hono is deliberately data-layer agnostic. When you reach for @clickhouse/client inside a Hono route, you get untyped query results. You're back to casting responses or writing manual interfaces that drift from the actual ClickHouse schema.",
        },
        {
          title: 'Edge runtimes have different ClickHouse connection requirements than Node.js',
          copy:
            'Cloudflare Workers and other edge runtimes do not support persistent TCP connections. ClickHouse connections need to go over HTTP, and the client configuration differs from a standard Node.js setup. Getting this wrong silently is easy.',
        },
        {
          title: "Hono's typed RPC client is wasted if ClickHouse responses are untyped any",
          copy:
            "Hono's hc() client propagates response types from your route handlers to the call site. But that only works if the route handler actually returns a typed value. If your ClickHouse query returns any, the type chain breaks and hc() provides no benefit.",
        },
      ]}
      solutionSection={{
        eyebrow: 'How it fits together',
        title: 'hypequery gives Hono routes a typed ClickHouse return value',
        description:
          "hypequery query builder methods return types inferred from your ClickHouse schema. When you call the query builder inside a Hono route handler and return c.json({ data: rows }), Hono infers the response shape from the rows type. The hc() RPC client gets the correct type automatically — no manual annotation on the route.",
        bullets: [
          'Generate schema.ts with npx @hypequery/cli generate against your ClickHouse instance',
          'Call the hypequery query builder inside Hono route handlers',
          'Use zValidator from @hono/zod-validator for input validation — same pattern as hypequery input schemas',
          'Return c.json({ data: rows }) — Hono infers the response type from rows',
          'Use hc<AppType>() on the client to get fully typed responses from your ClickHouse analytics routes',
        ],
        codePanel: {
          eyebrow: 'Hono route',
          title: 'Typed ClickHouse analytics route in Hono',
          description:
            'Auth middleware sets tenantId on the Hono context. The route handler reads it and passes it directly to the ClickHouse WHERE clause via the query builder.',
          code: honoRouteCode,
        },
      }}
      implementationSection={{
        eyebrow: 'Hono RPC pattern',
        title: 'End-to-end typed analytics with Hono RPC and hypequery',
        description:
          "Hono's typed RPC system requires that route handlers return typed values. hypequery satisfies that requirement by inferring column types from your schema — so the hc() client on the browser side gets the correct shape for every ClickHouse response without any manual type definition.",
        paragraphs: [
          "This pattern translates cleanly between Node.js and fetch-based runtimes. The hypequery query builder uses ClickHouse over HTTP, which fits the deployment model Hono is commonly used for.",
          'If you need interactive API documentation alongside the Hono routes, pair this with @hypequery/serve. The serve() function generates an OpenAPI spec and Swagger UI from your query definitions without requiring manual annotation.',
        ],
        codePanel: {
          eyebrow: 'Full stack example',
          title: 'Hono app with typed RPC and ClickHouse data layer',
          description:
            'The AppType export carries route types to the client. The hc() call gets back typed data — { day: string; users: string }[] — without any manual interface on the client side.',
          code: honoRpcCode,
        },
      }}
      searchIntentCards={[
        {
          title: 'ClickHouse Hono TypeScript',
          copy:
            'Hono solves routing cleanly. The missing piece is a ClickHouse query layer that returns typed rows so route handlers and clients are not glued together with manual interfaces.',
        },
        {
          title: 'Hono analytics API ClickHouse',
          copy:
            'A Hono analytics API still needs validated inputs, predictable query results, and middleware-driven auth context. hypequery handles the ClickHouse part while Hono stays in charge of the HTTP layer.',
        },
        {
          title: 'ClickHouse edge runtime TypeScript',
          copy:
            'Fetch-based runtimes change the deployment shape more than the query shape. ClickHouse over HTTP fits that model, so the same core query definitions can move between Node and worker-style runtimes.',
        },
        {
          title: 'Hono RPC typed analytics',
          copy:
            "Hono's hc() client is most useful when the handler already returns a typed value. Schema-generated query results give Hono something concrete to propagate to the client.",
        },
      ]}
      readingLinks={[
        {
          href: '/clickhouse-rest-api',
          title: 'ClickHouse REST API',
          description: 'The general REST API guide — covers @hypequery/serve as a standalone HTTP server.',
        },
        {
          href: '/clickhouse-openapi',
          title: 'ClickHouse OpenAPI',
          description: 'Auto-generated OpenAPI specs from hypequery query definitions.',
        },
        {
          href: '/clickhouse-typescript',
          title: 'ClickHouse TypeScript',
          description: 'Schema generation and the typed query builder — the foundation for Hono integration.',
        },
        {
          href: '/clickhouse-nodejs',
          title: 'ClickHouse Node.js',
          description: 'Node.js-specific ClickHouse integration patterns for non-edge deployments.',
        },
      ]}
      relatedPillars={[
        { href: '/clickhouse-rest-api', label: 'ClickHouse REST API' },
        { href: '/clickhouse-openapi', label: 'ClickHouse OpenAPI' },
        { href: '/clickhouse-typescript', label: 'ClickHouse TypeScript' },
        { href: '/clickhouse-nodejs', label: 'ClickHouse Node.js' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Add typed ClickHouse routes to your Hono app',
        description:
          'Generate schema bindings with npx @hypequery/cli generate, then call the hypequery query builder inside your Hono route handlers. The response types flow through to the hc() RPC client automatically.',
        primaryCta: { href: '/docs/quick-start', label: 'Open the quick start' },
        secondaryCta: { href: '/clickhouse-rest-api', label: 'See the REST API guide' },
      }}
    />
  );
}
