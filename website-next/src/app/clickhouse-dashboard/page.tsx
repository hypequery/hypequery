import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'ClickHouse Dashboard Data Layer for React and TypeScript | hypequery',
  description:
    'Build ClickHouse dashboards without inventing a custom API and fetch layer for every chart.',
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

export function DashboardPage() {
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
      description="The chart library is usually not the hard part. The hard part is that every panel wants a route, a request helper, a response type, loading state handling, and one more place for the metric definition to drift. hypequery gives the dashboard a cleaner backend path."
      primaryCta={{ href: '/docs/quick-start', label: 'Start with hypequery' }}
      secondaryCta={{ href: '/clickhouse-react', label: 'See React hook setup' }}
      stats={[
        { label: 'Frontend layer', value: '@hypequery/react hooks' },
        { label: 'Backend layer', value: '@hypequery/serve endpoints' },
        { label: 'Best for', value: 'Multi-chart analytics dashboards' },
      ]}
      problems={[
        {
          title: 'Every chart grows its own fetch path',
          copy:
            'A dashboard starts with one helper and ends with a patchwork of route handlers, response mappers, and component-specific fetch code. The backend logic becomes harder to reason about than the visual layer.',
        },
        {
          title: 'Panel logic drifts when the metric changes',
          copy:
            'Rename a field or change an aggregation and you can break half the dashboard if every panel has its own assumptions about the response shape.',
        },
        {
          title: 'Shared filters make duplication worse',
          copy:
            'Date ranges, tenant scope, and common breakdowns get repeated across panels. That duplication is where dashboards become fragile long before the chart count gets large.',
        },
      ]}
      solutionSection={{
        eyebrow: 'The dashboard shape',
        title: 'Keep query definitions on the server and let the UI consume typed hooks',
        description:
          'A dashboard usually wants a small set of named queries, one server-side place to own them, and a client hook layer that inherits those types instead of recreating them in React.',
        bullets: [
          'Generate schema types from ClickHouse with npx @hypequery/cli generate',
          'Define named dashboard queries with typed inputs and typed outputs',
          'Keep shared filters and scoping close to the backend definition',
          'Expose queries over HTTP with @hypequery/serve',
          'Derive React hooks from the serve API type so the browser stays in sync',
        ],
        codePanel: {
          eyebrow: 'Query definitions',
          title: 'Two dashboard queries that live in one server file',
          description:
            'This is the part teams often skip. Put the dashboard queries in one file first, then let the client build on top of that instead of inventing panel-by-panel route code.',
          code: queryDefinitionCode,
        },
      }}
      implementationSection={{
        eyebrow: 'React dashboard',
        title: 'Panels stay focused on rendering instead of networking glue',
        description:
          'Once the hook layer is derived from the API type, the component can just ask for a named query and render the result. That is a better place to spend complexity than hand-maintaining request wrappers around every chart.',
        paragraphs: [
          'This matters more as the dashboard gets bigger. Shared filters, cache invalidation, and panel reuse are all easier when the panels are consuming one typed backend surface.',
          'If your main concern is the hook layer itself, continue to the React page. If the problem is broader application reuse, step back to the analytics page.',
        ],
        codePanel: {
          eyebrow: 'Dashboard component',
          title: 'A component that only worries about UI state',
          description:
            'The component does not need to know how ClickHouse works. It gets typed data, handles loading state, and renders the panel.',
          code: dashboardComponentCode,
        },
      }}
      searchIntentCards={[
        {
          title: 'What this page replaces',
          copy:
            'It replaces the usual mix of ad hoc API routes, fetch helpers, and copied response types that accumulate when teams build dashboards panel by panel.',
        },
        {
          title: 'Where the complexity should live',
          copy:
            'The backend should own metric definitions and response shapes. The frontend should own rendering, interaction, and cache behavior.',
        },
        {
          title: 'When this starts to pay off',
          copy:
            'You feel the benefit as soon as more than one panel depends on shared filters or reused metrics. That is usually much earlier than teams expect.',
        },
        {
          title: 'What to read next',
          copy:
            'Use the React page for client-side hook details and the Next.js page if the dashboard lives inside App Router.',
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
        title: 'Replace one dashboard panel end to end',
        description:
          'Take one panel that currently owns its own route and fetch code, move it to a named server query, and let the component consume a typed hook instead. That gives you the real signal quickly.',
        primaryCta: { href: '/docs/quick-start', label: 'Start with hypequery' },
        secondaryCta: { href: '/clickhouse-react', label: 'See React hook setup' },
      }}
    />
  );
}
