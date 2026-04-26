import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'ClickHouse Dashboard Data Layer for React and TypeScript | hypequery',
  description:
    'Keep multi-panel ClickHouse dashboards consistent with shared metric definitions, typed hooks, and one server-side contract for every chart.',
  alternates: {
    canonical: absoluteUrl('/clickhouse-dashboard'),
  },
  openGraph: {
    type: 'website',
    url: absoluteUrl('/clickhouse-dashboard'),
    title: 'ClickHouse Dashboard Data Layer for React and TypeScript | hypequery',
    description:
      'Keep multi-panel ClickHouse dashboards consistent with shared metric definitions, typed hooks, and one server-side contract for every chart.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClickHouse Dashboard Data Layer for React and TypeScript | hypequery',
    description:
      'Keep multi-panel ClickHouse dashboards consistent with shared metric definitions, typed hooks, and one server-side contract for every chart.',
  },
};

const queryDefinitionCode = `// analytics/dashboard-queries.ts
import { initServe } from '@hypequery/serve';
import { createHooks } from '@hypequery/react';
import { db } from '@/lib/clickhouse';
import { z } from 'zod';

const { query, serve } = initServe({
  context: (req) => ({
    db,
    tenantId: req.headers['x-tenant-id'] as string,
  }),
});

export const pageViews = query({
  input: z.object({
    startDate: z.string(),
    endDate: z.string(),
    granularity: z.enum(['hour', 'day']).default('day'),
  }),
  query: ({ ctx, input }) =>
    ctx.db
      .table('page_events')
      .select('toStartOfDay(created_at) as date', 'count() as views')
      .where('tenant_id', 'eq', ctx.tenantId)
      .where('created_at', 'gte', input.startDate)
      .where('created_at', 'lte', input.endDate)
      .groupBy('date')
      .orderBy('date', 'ASC')
      .execute(),
});

export const topPages = query({
  input: z.object({ limit: z.number().int().min(1).max(50).default(10) }),
  query: ({ ctx, input }) =>
    ctx.db
      .table('page_events')
      .select('path', 'count() as views', 'uniq(session_id) as sessions')
      .where('tenant_id', 'eq', ctx.tenantId)
      .groupBy('path')
      .orderBy('views', 'DESC')
      .limit(input.limit)
      .execute(),
});

export const api = serve({ queries: { pageViews, topPages } });`;

const dashboardComponentCode = `// components/DashboardPage.tsx
import { createHooks } from '@hypequery/react';
import { InferApiType } from '@hypequery/serve';
import type { api } from '@/analytics/dashboard-queries';

type Api = InferApiType<typeof api>;

const { useQuery } = createHooks<Api>({ baseUrl: '/api/analytics' });

export function DashboardPage({ tenantId }: { tenantId: string }) {
  const { data: views, isLoading: viewsLoading } = useQuery('pageViews', {
    startDate: '2026-04-01',
    endDate: '2026-04-30',
    granularity: 'day',
  });

  const { data: pages, isLoading: pagesLoading } = useQuery('topPages', {
    limit: 10,
  });

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section>
        <h2>Page views over time</h2>
        {viewsLoading ? (
          <Skeleton />
        ) : (
          <LineChart
            data={views ?? []}
            xKey="date"
            yKey="views"
          />
        )}
      </section>
      <section>
        <h2>Top pages</h2>
        {pagesLoading ? (
          <Skeleton />
        ) : (
          <DataTable
            rows={pages ?? []}
            columns={['path', 'views', 'sessions']}
          />
        )}
      </section>
    </div>
  );
}`;

export default function ClickHouseDashboardPage() {
  return (
    <ClickhousePillarPage
      eyebrow="ClickHouse Dashboard"
      title="Build typed ClickHouse dashboards without a custom data layer"
      description="The hard part of a ClickHouse dashboard is rarely the chart library. It is keeping the backend metric definitions, API contracts, and frontend data shapes aligned as the dashboard grows from one panel to twenty. hypequery gives TypeScript teams a shared path from query definition to React component."
      primaryCta={{ href: '/docs/quick-start', label: 'Open quick start' }}
      secondaryCta={{ href: '/clickhouse-react', label: 'See React hook setup' }}
      stats={[
        { label: 'Frontend layer', value: '@hypequery/react hooks' },
        { label: 'Backend layer', value: '@hypequery/serve endpoints' },
        { label: 'Best for', value: 'Multi-chart analytics dashboards' },
      ]}
      problems={[
        {
          title: 'Most teams write a custom API layer between ClickHouse and the dashboard',
          copy:
            'Express routes, manual fetch calls, and hand-written TypeScript interfaces get invented for every dashboard project. The query logic ends up spread across routes, client helpers, and component files — and none of it is reusable.',
        },
        {
          title: 'Dashboard data shapes are tightly coupled to ClickHouse queries',
          copy:
            'When a query changes — a column is renamed, an aggregation is added — the frontend component breaks silently. Without schema-generated types flowing end-to-end, the connection between query output and chart input is a runtime assumption.',
        },
        {
          title: 'Multi-tenant dashboards need tenant isolation in every query',
          copy:
            'Adding a WHERE tenant_id = ? clause to every dashboard query is easy to forget and hard to audit. A shared analytics layer can centralise tenant scoping so it is applied through the standard query path instead of copied into every panel.',
        },
      ]}
      solutionSection={{
        eyebrow: 'Query and hook setup',
        title: 'Define dashboard queries once, derive React hooks from the same types',
        description:
          'The right model for a ClickHouse dashboard is a server-side analytics layer with named, typed queries — and a client hook layer that derives its types from the server definition, not a hand-maintained copy.',
        bullets: [
          'Generate schema types from ClickHouse with npx @hypequery/cli generate',
          'Define named dashboard queries with typed inputs and typed outputs',
          'Apply tenant isolation at context level, not per-query',
          'Expose queries over HTTP with @hypequery/serve',
          'Derive React hooks from the serve API type so the browser stays in sync',
        ],
        codePanel: {
          eyebrow: 'Query definitions',
          title: 'Named, typed dashboard queries with tenant isolation',
          description:
            'The context receives tenantId once. Every query downstream automatically scopes to the right tenant without each query re-implementing the filter.',
          code: queryDefinitionCode,
        },
      }}
      implementationSection={{
        eyebrow: 'React dashboard',
        title: 'Components get typed data — no fetch glue required',
        description:
          'Once the hook layer is derived from the serve API type, React components become straightforward: call a named hook with typed input, handle loading and data states, render. No manual response typing, no duplicated request helpers.',
        paragraphs: [
          'Multi-chart dashboards benefit the most from this pattern. When a shared date range filter changes, every hook sharing that input can invalidate together via TanStack Query — without custom cache invalidation logic.',
          'The same analytics definitions that serve the React dashboard can also power server-rendered pages, scheduled reports, or external API consumers — the query is written once.',
        ],
        codePanel: {
          eyebrow: 'Dashboard component',
          title: 'Typed hooks in a multi-panel dashboard',
          description:
            'The component never imports ClickHouse types directly. It only sees the output of the typed hook — which is guaranteed to match the actual query output by construction.',
          code: dashboardComponentCode,
        },
      }}
      searchIntentCards={[
        {
          title: 'ClickHouse dashboard TypeScript',
          copy:
            'The real dashboard problem is not choosing a charting library. It is keeping every panel pointed at the same metric definitions and output shapes as the dashboard grows.',
        },
        {
          title: 'React ClickHouse dashboard',
          copy:
            'React should consume typed hooks, not hand-written fetch wrappers per panel. Keep ClickHouse queries on the server and let chart components depend on one stable contract.',
        },
        {
          title: 'ClickHouse analytics dashboard API',
          copy:
            'A dashboard API should serve named metrics with typed inputs and outputs, not a different ad hoc route for every chart. That matters once metrics are reused across panels and teams.',
        },
        {
          title: 'ClickHouse real-time dashboard React',
          copy:
            'Real-time dashboards need two pieces: a low-latency server query layer and a browser cache strategy. hypequery covers the first piece; TanStack Query covers the second.',
        },
      ]}
      readingLinks={[
        {
          href: '/clickhouse-react',
          title: 'ClickHouse React',
          description: 'Full guide to typed hooks and hook setup for ClickHouse dashboards.',
        },
        {
          href: '/clickhouse-rest-api',
          title: 'ClickHouse REST API',
          description: 'Expose ClickHouse queries as a typed HTTP API without writing Express routes.',
        },
        {
          href: '/clickhouse-nextjs',
          title: 'ClickHouse Next.js',
          description: 'Combine server components, API routes, and React hooks in a Next.js dashboard.',
        },
        {
          href: '/blog/turn-your-clickhouse-schema-into-a-type-safe-analytics-layer-in-5-minutes',
          title: 'Turn your ClickHouse schema into a type-safe analytics layer',
          description: 'The complete path from schema generation to working dashboard hooks.',
        },
      ]}
      relatedPillars={[
        { href: '/clickhouse-react', label: 'ClickHouse React' },
        { href: '/clickhouse-rest-api', label: 'ClickHouse REST API' },
        { href: '/clickhouse-nextjs', label: 'ClickHouse Next.js' },
        { href: '/clickhouse-saas-analytics', label: 'ClickHouse SaaS Analytics' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Generate your schema and wire the first typed dashboard query',
        description:
          'The fastest path to a working typed dashboard is schema generation followed by a single named query. Once that runs, the hook layer and React component follow the same pattern for every chart you add.',
        primaryCta: { href: '/docs/quick-start', label: 'Open quick start' },
        secondaryCta: { href: '/clickhouse-react', label: 'See React hook setup' },
      }}
    />
  );
}
