import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'ClickHouse SaaS Analytics — Multi-Tenant TypeScript Layer | hypequery',
  description:
    'Build customer-facing analytics on ClickHouse for your SaaS product. hypequery handles tenant isolation, typed APIs, React hooks, and dashboard delivery — without building a custom analytics layer.',
  alternates: { canonical: absoluteUrl('/clickhouse-saas-analytics') },
  openGraph: {
    type: 'website',
    url: absoluteUrl('/clickhouse-saas-analytics'),
    title: 'ClickHouse SaaS Analytics — Multi-Tenant TypeScript Layer | hypequery',
    description:
      'Embed customer-facing analytics in your SaaS product. hypequery wraps ClickHouse with tenant isolation, typed REST APIs, and React hooks.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClickHouse SaaS Analytics | hypequery',
    description:
      'Build customer-facing analytics on ClickHouse. hypequery handles tenant isolation, typed APIs, and dashboard delivery for SaaS products.',
  },
};

const tenantCode = `import { initServe } from '@hypequery/serve';

const { query, serve } = initServe({
  // inject tenant from JWT or API key on every request
  context: (req) => ({
    db,
    tenantId: verifyJwt(req.headers.authorization).tenantId,
  }),
});

const usageDashboard = query({
  query: async ({ ctx }) =>
    ctx.db
      .table('events')
      .where('tenant_id', 'eq', ctx.tenantId) // part of the default query path
      .groupBy(['event_name', 'date'])
      .count('id', 'total')
      .orderBy('date', 'DESC')
      .execute(),
});

const app = serve({ queries: { usageDashboard } });`;

const reactCode = `import { createHooks } from '@hypequery/react';
import { usageDashboard } from './analytics';

const { useUsageDashboard } = createHooks({ usageDashboard });

function AnalyticsDashboard() {
  const { data, loading } = useUsageDashboard();

  if (loading) return <Skeleton />;

  return (
    <BarChart
      data={data}
      xKey="date"
      yKey="total"
    />
  );
}`;

export default function ClickHouseSaasAnalyticsPage() {
  return (
    <ClickhousePillarPage
      eyebrow="ClickHouse SaaS Analytics"
      title="Embed customer-facing analytics in your SaaS product with ClickHouse"
      description="Customer-facing analytics is where ClickHouse stops being just a database choice and becomes a product architecture problem. You need tenant scoping, stable metric contracts, and dashboard delivery patterns that can survive feature growth. hypequery is aimed at that layer."
      primaryCta={{ href: '/docs/quick-start', label: 'Get started' }}
      secondaryCta={{ href: '/clickhouse-multi-tenant-analytics', label: 'See multi-tenant guide' }}
      stats={[
        { label: 'Tenant isolation', value: 'Enforced in context' },
        { label: 'Delivery', value: 'REST API + React hooks' },
        { label: 'Best for', value: 'Customer-facing SaaS analytics' },
      ]}
      problems={[
        {
          title: 'Tenant isolation is easy to forget and hard to audit',
          copy:
            'Every ClickHouse query in a multi-tenant SaaS product needs a tenant_id filter. Applying it at the query level means every developer has to remember it — and auditing whether every query is correctly isolated is slow and error-prone.',
        },
        {
          title: 'Building a custom analytics API layer takes weeks',
          copy:
            'Most SaaS teams build a custom Express or Next.js API layer between ClickHouse and the dashboard frontend. Auth, tenancy, validation, response typing — it is not trivial and it is not their core product.',
        },
        {
          title: 'Analytics queries get duplicated across the product',
          copy:
            'The same usage metrics appear on the customer dashboard, the admin panel, CSV exports, and scheduled reports. Each surface has its own query implementation that drifts from the others.',
        },
      ]}
      solutionSection={{
        eyebrow: 'How hypequery handles SaaS analytics',
        title: 'Tenant isolation in the context layer, not the query layer',
        description:
          'hypequery injects tenant context once — at the request level — and makes it available to every query. That gives teams a standard place to apply tenant scoping instead of threading tenant IDs through every request shape by hand. Define analytics queries once and serve them across every product surface.',
        bullets: [
          'Tenant ID injected per-request from JWT, API key, or session',
          'Every query in the serve() call has access to typed tenant context',
          'Tenant scoping is centralised in the standard request path',
          'Same query definition serves dashboard, API, export, and report',
          'React hooks consume typed endpoints directly — no custom client code',
        ],
        codePanel: {
          eyebrow: 'Tenant isolation',
          title: 'Tenant context enforced at the request level',
          description:
            'The tenant ID is injected once in the context function. Every query in the serve() call has access to it automatically, which keeps tenant scoping in one reviewable place.',
          code: tenantCode,
        },
      }}
      implementationSection={{
        eyebrow: 'Dashboard delivery',
        title: 'Typed React hooks for your customer dashboard',
        description:
          '@hypequery/react wraps your typed REST endpoints as React hooks. Your dashboard components get typed data without writing custom fetch logic, managing loading states manually, or handling error boundaries from scratch.',
        paragraphs: [
          'The hook knows the exact shape of the response because it comes from the same type definition as the ClickHouse query. When the query changes, the hook type updates automatically.',
          'Read the multi-tenant analytics guide for the full isolation pattern, and the React guide for hook usage in dashboard components.',
        ],
        codePanel: {
          eyebrow: 'React hooks',
          title: 'Typed dashboard components from ClickHouse queries',
          description:
            'createHooks() wraps your query definitions as React hooks. Data is typed, loading state is managed, and the response shape matches the ClickHouse schema — no glue code.',
          code: reactCode,
        },
      }}
      searchIntentCards={[
        {
          title: 'Embedded analytics ClickHouse SaaS',
          copy:
            'Embedding analytics in a SaaS product on ClickHouse requires tenant scoping, a typed API layer, and dashboard delivery. hypequery is positioned as the TypeScript layer that ties those concerns together inside one codebase.',
        },
        {
          title: 'ClickHouse multi-tenant analytics TypeScript',
          copy:
            'The most reliable way to enforce tenant isolation in ClickHouse is to inject tenantId at the request context level rather than relying on per-query filters. hypequery makes this the default pattern.',
        },
        {
          title: 'Customer-facing analytics on ClickHouse',
          copy:
            'ClickHouse handles the volume and cardinality that customer-facing analytics requires. hypequery provides the TypeScript layer between ClickHouse and your product — typed queries, validated APIs, and React hooks.',
        },
        {
          title: 'ClickHouse analytics API for SaaS dashboard',
          copy:
            'Instead of building a custom analytics API layer with Express or Next.js API routes, define your analytics queries with hypequery and serve them as typed REST endpoints with OpenAPI docs automatically.',
        },
      ]}
      readingLinks={[
        {
          href: '/clickhouse-multi-tenant-analytics',
          title: 'ClickHouse multi-tenant analytics',
          description: 'The full guide to tenant isolation patterns in ClickHouse with hypequery.',
        },
        {
          href: '/clickhouse-react',
          title: 'ClickHouse React hooks',
          description: 'How to consume typed ClickHouse analytics as React hooks in dashboard components.',
        },
        {
          href: '/clickhouse-rest-api',
          title: 'ClickHouse REST API',
          description: 'Serving ClickHouse query definitions as typed HTTP endpoints with @hypequery/serve.',
        },
        {
          href: '/clickhouse-nextjs',
          title: 'ClickHouse Next.js',
          description: 'Integrating ClickHouse analytics into Next.js App Router handlers and server components.',
        },
      ]}
      relatedPillars={[
        { href: '/clickhouse-multi-tenant-analytics', label: 'Multi-Tenant Analytics' },
        { href: '/clickhouse-react', label: 'ClickHouse React' },
        { href: '/clickhouse-rest-api', label: 'ClickHouse REST API' },
        { href: '/clickhouse-analytics', label: 'ClickHouse Analytics' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Build your first tenant-isolated ClickHouse analytics endpoint',
        description:
          'Start with schema generation, define a tenant-scoped query, and serve it as a typed API endpoint. The React hook for your dashboard comes from the same definition.',
        primaryCta: { href: '/docs/quick-start', label: 'Open quick start' },
        secondaryCta: { href: '/clickhouse-multi-tenant-analytics', label: 'Read the multi-tenant guide' },
      }}
    />
  );
}
