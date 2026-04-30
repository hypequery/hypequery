import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'ClickHouse SaaS Analytics — Multi-Tenant TypeScript Layer | hypequery',
  description:
    'Build customer-facing ClickHouse analytics with tenant-scoped query definitions, typed APIs, and dashboard delivery that does not fork per surface.',
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
import { InferApiType } from '@hypequery/serve';
import type { api } from '@/analytics/usage-queries';

type Api = InferApiType<typeof api>;

const { useQuery } = createHooks<Api>({ baseUrl: '/api/analytics' });

function AnalyticsDashboard() {
  const { data, isLoading } = useQuery('usageDashboard', {});

  if (isLoading) return <Skeleton />;

  return (
    <BarChart
      data={data ?? []}
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
      description="This is the point where analytics becomes product surface, not just internal reporting. You need tenant scoping that is hard to bypass, a stable API for the UI, and one query path that can serve dashboards, exports, and internal support views without splitting into separate implementations."
      primaryCta={{ href: '/docs/quick-start', label: 'Start with hypequery' }}
      secondaryCta={{ href: '/clickhouse-multi-tenant-analytics', label: 'See multi-tenant guide' }}
      stats={[
        { label: 'Tenant isolation', value: 'Enforced in context' },
        { label: 'Delivery', value: 'REST API + React hooks' },
        { label: 'Best for', value: 'Customer-facing SaaS analytics' },
      ]}
      problems={[
        {
          title: 'Tenant scoping fails quietly when it is copied by hand',
          copy:
            'If every query author has to remember the tenant filter, somebody eventually forgets it. That is not a style issue. It is a product risk.',
        },
        {
          title: 'Customer-facing analytics grows more consumers than expected',
          copy:
            'The same usage metric often ends up on the customer dashboard, in support tooling, in exports, and inside internal admin screens. Separate implementations for each surface do not stay aligned for long.',
        },
        {
          title: 'The API layer becomes a product of its own',
          copy:
            'Once auth, validation, tenancy, and response typing are all hand-built around ClickHouse, teams accidentally sign up to maintain an analytics platform inside the app.',
        },
      ]}
      solutionSection={{
        eyebrow: 'The safe default',
        title: 'Put tenant context in the standard request path',
        description:
          'The useful move here is centralization. Put auth and tenant lookup in the request context, make every query read from that context, and keep the customer-facing API surface tied to those shared definitions.',
        bullets: [
          'Tenant ID injected per-request from JWT, API key, or session',
          'Every query in the serve() call has access to typed tenant context',
          'Tenant scoping lives in one reviewable path instead of every query file',
          'The same query definition can serve dashboard, API, export, and report use cases',
          'React hooks consume typed endpoints directly instead of custom client glue',
        ],
        codePanel: {
          eyebrow: 'Tenant isolation',
          title: 'Inject tenant once, use it everywhere downstream',
          description:
            'The important thing is not the syntax. It is that the tenant boundary stops being optional once the request enters the standard query path.',
          code: tenantCode,
        },
      }}
      implementationSection={{
        eyebrow: 'Dashboard delivery',
        title: 'Let the UI consume the typed API instead of rebuilding it',
        description:
          'Once the backend surface is tenant-scoped and typed, the frontend can stay much thinner. Customer dashboards consume the existing API through hooks instead of inventing another analytics client inside the browser.',
        paragraphs: [
          'That does not just help the customer dashboard. The same endpoint shape can also serve support tooling or internal product surfaces without another round of hand-written typing.',
          'Read the multi-tenant guide for the full isolation story, and the React guide if you want the hook layer details by themselves.',
        ],
        codePanel: {
          eyebrow: 'React hooks',
          title: 'A customer-facing component that stays close to the UI',
          description:
            'The component does not need to know how tenant scoping works or how the query is built. It consumes the typed surface that the backend already owns.',
          code: reactCode,
        },
      }}
      searchIntentCards={[
        {
          title: 'What this page is really about',
          copy:
            'It is about not letting customer-facing analytics split into one-off dashboard code, one-off export code, and one-off admin code with different isolation assumptions.',
        },
        {
          title: 'Why tenant context matters so much',
          copy:
            'The safest default is to make tenant identity part of the request context and let every query read from it. That is much easier to review than trusting scattered filters.',
        },
        {
          title: 'What teams get out of this',
          copy:
            'One API surface, one scoping model, and fewer opportunities for customer-facing metrics to drift between product surfaces.',
        },
        {
          title: 'Where to go after this',
          copy:
            'Use the multi-tenant guide for the deeper isolation pattern and the dashboard or React pages for the frontend delivery side.',
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
        title: 'Start with one customer-facing metric and scope it properly',
        description:
          'Pick a metric that reaches customers, move it behind a tenant-scoped query definition, and expose it once through the standard API path. That gives you the right foundation before the surface area multiplies.',
        primaryCta: { href: '/docs/quick-start', label: 'Start with hypequery' },
        secondaryCta: { href: '/clickhouse-multi-tenant-analytics', label: 'Read the multi-tenant guide' },
      }}
    />
  );
}
