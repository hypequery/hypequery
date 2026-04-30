import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'ClickHouse React',
  description:
    'Use ClickHouse from React through typed hooks and a shared server API instead of hand-rolled fetch wrappers per component.',
  alternates: {
    canonical: absoluteUrl('/clickhouse-react'),
  },
  openGraph: {
    type: 'website',
    url: absoluteUrl('/clickhouse-react'),
    title: 'ClickHouse React | Typed Hooks for Analytics Apps',
    description:
      'Build React dashboards on ClickHouse with shared types, generated hooks, and reusable analytics endpoints.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClickHouse React | Typed Hooks for Analytics Apps',
    description:
      'Build React dashboards on ClickHouse with shared types, generated hooks, and reusable analytics endpoints.',
  },
};

const hooksCode = `import { createHooks } from '@hypequery/react';
import { InferApiType } from '@hypequery/serve';
import type { api } from '@/analytics/queries';

type Api = InferApiType<typeof api>;

export const { useQuery, useMutation } = createHooks<Api>({
  baseUrl: '/api/analytics',
});`;

const componentCode = `export function RevenueChart() {
  const { data, isLoading } = useQuery('revenueByDay', {
    startDate: '2026-01-01',
    endDate: '2026-01-31',
  });

  if (isLoading) return <div>Loading...</div>;

  return <Chart data={data ?? []} />;
}`;

export default function ClickHouseReactPage() {
  return (
    <ClickhousePillarPage
      eyebrow="ClickHouse React"
      title="Use ClickHouse in React with typed hooks instead of custom fetch glue"
      description="This page starts where the server pages stop. The query already exists on the backend. The React problem is how components consume it without rebuilding request helpers, cache logic, and response types over and over."
      primaryCta={{ href: '/docs/react/getting-started', label: 'Open React docs' }}
      secondaryCta={{ href: '/docs/react/using-queries', label: 'See hook usage examples' }}
      stats={[
        { label: 'Client layer', value: '@hypequery/react' },
        { label: 'Caching', value: 'TanStack Query' },
        { label: 'Best for', value: 'Interactive dashboards' },
      ]}
      problems={[
        {
          title: 'Components keep growing their own request wrappers',
          copy:
            'A dashboard starts with one chart and quickly becomes a stack of `fetch`, loading state, error handling, cache invalidation, and manually typed response objects.',
        },
        {
          title: 'The browser should not own analytics schema details',
          copy:
            'The UI should not need to know about ClickHouse return types or how backend query code is assembled. It should call a typed API surface and render what comes back.',
        },
        {
          title: 'Client typing drifts when it is maintained separately',
          copy:
            'Once the React layer starts owning its own request and response types, changes show up as UI bugs rather than compiler errors.',
        },
      ]}
      solutionSection={{
        eyebrow: 'The client-side shape',
        title: 'Derive hooks from the server API instead of recreating it',
        description:
          'The clean React model is straightforward: keep analytics on the server, expose a typed API, and let the hook layer inherit that type so components stay focused on UI behavior.',
        bullets: [
          'Keep ClickHouse access and schema knowledge on the server',
          'Infer hook types directly from the serve API',
          'Use TanStack Query for cache lifecycle and background refetching',
          'Share one query contract across charts, tables, and filters',
          'Avoid manually duplicating request and response types in React',
        ],
        codePanel: {
          eyebrow: 'Hook setup',
          title: 'One hook layer for the whole React app',
          description:
            'This is the boundary worth preserving. The hook layer learns from the API type rather than inventing its own client-side contract.',
          code: hooksCode,
        },
      }}
      implementationSection={{
        eyebrow: 'Dashboard usage',
        title: 'Let components deal with UI state, not transport details',
        description:
          'Once the hooks exist, a component can ask for a named query and render it. That keeps the React layer concerned with charts, filters, and interaction instead of transport details.',
        paragraphs: [
          'This pays off quickly in dashboards where several panels share filters and revalidation rules. TanStack Query handles the browser lifecycle while the backend still owns the actual analytics definition.',
          'If your main concern is App Router delivery and server components, use the Next.js page. This page is specifically about the client hook layer.',
        ],
        codePanel: {
          eyebrow: 'Component',
          title: 'A chart component that only consumes a typed hook',
          description:
            'The component does not import ClickHouse types or know about SQL. It consumes the typed hook and renders UI state.',
          code: componentCode,
        },
      }}
      searchIntentCards={[
        {
          title: 'What this page replaces',
          copy:
            'It replaces component-level fetch helpers and hand-written hook wrappers that slowly diverge from the backend response shape.',
        },
        {
          title: 'Where React should stop',
          copy:
            'The React layer should own cache behavior and UI state, not ClickHouse details or backend schema assumptions.',
        },
        {
          title: 'What makes the typing trustworthy',
          copy:
            'The hook types are useful because they are derived from the backend API definition, which is itself derived from the query layer.',
        },
        {
          title: 'Where to branch next',
          copy:
            'Use the Next.js page for local server execution versus HTTP delivery. Use this page when the hook layer itself is the thing you are designing.',
        },
      ]}
      readingLinks={[
        {
          href: '/docs/react/getting-started',
          title: 'React getting started',
          description: 'Set up the hook layer and provider wiring.',
        },
        {
          href: '/docs/react/advanced-patterns',
          title: 'Advanced React patterns',
          description: 'Handle method configuration, invalidation, and richer client workflows.',
        },
        {
          href: '/clickhouse-nextjs',
          title: 'ClickHouse Next.js',
          description: 'Pair React hooks with App Router and server-side execution.',
        },
        {
          href: '/blog/turn-your-clickhouse-schema-into-a-type-safe-analytics-layer-in-5-minutes',
          title: 'Turn your ClickHouse schema into a type-safe analytics layer',
          description: 'See the full path from schema generation to hooks.',
        },
      ]}
      relatedPillars={[
        { href: '/clickhouse-nextjs', label: 'ClickHouse Next.js' },
        { href: '/clickhouse-typescript', label: 'ClickHouse TypeScript' },
        { href: '/clickhouse-analytics', label: 'ClickHouse Analytics' },
        { href: '/clickhouse-multi-tenant-analytics', label: 'ClickHouse Multi-Tenant Analytics' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Set up typed hooks on top of a shared server definition',
        description:
          'Do not start by inventing a browser-only analytics client. Start from the server API type, then let the React layer inherit it.',
        primaryCta: { href: '/docs/react/getting-started', label: 'Open React setup' },
        secondaryCta: { href: '/clickhouse-nextjs', label: 'See Next.js architecture' },
      }}
    />
  );
}
