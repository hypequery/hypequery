import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'ClickHouse React',
  description:
    'Use ClickHouse with React through typed hooks, shared query definitions, and TanStack Query-powered caching instead of hand-rolled fetch wrappers.',
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
      description="React teams want analytics queries that are cache-aware, type-safe, and easy to reuse across charts and dashboards. hypequery gives you shared query definitions on the server and typed React hooks on the client."
      primaryCta={{ href: '/docs/react/getting-started', label: 'Open React docs' }}
      secondaryCta={{ href: '/docs/react/using-queries', label: 'See hook usage examples' }}
      stats={[
        { label: 'Client layer', value: '@hypequery/react' },
        { label: 'Caching', value: 'TanStack Query' },
        { label: 'Best for', value: 'Interactive dashboards' },
      ]}
      problems={[
        {
          title: 'React dashboards grow a lot of fragile fetch code',
          copy:
            'Teams often hand-roll request helpers, response types, loading states, and cache invalidation logic for every chart. The complexity compounds fast.',
        },
        {
          title: 'Client code should not know raw ClickHouse details',
          copy:
            'A browser should not care about schema drift, `UInt64` mapping, or how analytics SQL is built. It should call a typed contract and render the result.',
        },
        {
          title: 'Server and client types usually drift apart',
          copy:
            'When the API layer and React layer are typed separately, changes arrive as runtime bugs instead of compile-time feedback.',
        },
      ]}
      solutionSection={{
        eyebrow: 'React-friendly model',
        title: 'Generate hooks from the same analytics API your server already owns',
        description:
          'The stable pattern is straightforward: define analytics on the server, expose them over HTTP, and derive React hooks from that definition so the browser stays thin.',
        bullets: [
          'Keep ClickHouse access and schema knowledge on the server',
          'Infer hook types directly from the serve API',
          'Use TanStack Query for cache lifecycle and background refetching',
          'Share one query contract across charts, tables, and filters',
          'Avoid manually duplicating request and response types in React',
        ],
        codePanel: {
          eyebrow: 'Hook setup',
          title: 'Create hooks from the server API type',
          description:
            'This is the key to keeping React in sync with the real analytics contract instead of maintaining a second hand-written client schema.',
          code: hooksCode,
        },
      }}
      implementationSection={{
        eyebrow: 'Dashboard usage',
        title: 'Keep components focused on rendering and interaction',
        description:
          'Once the hook layer exists, React components become much simpler. They ask for a named query with typed input, then render loading, error, and success states without custom networking glue.',
        paragraphs: [
          'This fits especially well with ClickHouse dashboards where multiple charts share filters and query lifecycles. TanStack Query handles the browser concerns while hypequery preserves the analytics contract.',
          'If your app is on Next.js, combine this pattern with the Next.js pillar page so server-rendered and client-rendered analytics use the same backend definitions.',
        ],
        codePanel: {
          eyebrow: 'Component',
          title: 'Use a typed analytics hook in React',
          description:
            'The component only deals with UI state. Query naming, input shape, and output typing all come from the shared analytics layer.',
          code: componentCode,
        },
      }}
      searchIntentCards={[
        {
          title: 'ClickHouse React hooks',
          copy:
            'If you are searching for React hooks for ClickHouse, the right abstraction is usually a typed analytics API plus generated hooks, not direct database access from the browser.',
        },
        {
          title: 'React dashboard data fetching for analytics',
          copy:
            'Interactive dashboards need cache control, background updates, and typed inputs. TanStack Query plus a schema-driven API is the pragmatic route.',
        },
        {
          title: 'Type-safe React queries on ClickHouse',
          copy:
            'Type safety only matters if the server contract is accurate. That starts with schema-driven analytics definitions, not just client-side TypeScript wrappers.',
        },
        {
          title: 'When React should call HTTP vs server code',
          copy:
            'Server components can execute locally, but browser components need HTTP. A shared analytics layer lets both paths use the same query definition.',
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
