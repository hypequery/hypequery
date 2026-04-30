import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'ClickHouse Next.js',
  description:
    'Build ClickHouse analytics into Next.js App Router without splitting query logic across route handlers, server components, and browser code.',
  alternates: {
    canonical: absoluteUrl('/clickhouse-nextjs'),
  },
  openGraph: {
    type: 'website',
    url: absoluteUrl('/clickhouse-nextjs'),
    title: 'ClickHouse Next.js | Typed Analytics for App Router',
    description:
      'Use ClickHouse in Next.js without duplicating SQL across route handlers, dashboards, and server components.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClickHouse Next.js | Typed Analytics for App Router',
    description:
      'Use ClickHouse in Next.js without duplicating SQL across route handlers, dashboards, and server components.',
  },
};

const routeCode = `import { api } from '@/analytics/queries';
import { createFetchHandler } from '@hypequery/serve';

const handler = createFetchHandler(api.handler);

export const runtime = 'nodejs';
export const GET = handler;
export const POST = handler;
export const OPTIONS = handler;`;

const serverCode = `import { api } from '@/analytics/queries';

export default async function RevenuePage() {
  const revenue = await api.run('revenueByDay', {
    input: {
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    },
  });

  return <pre>{JSON.stringify(revenue, null, 2)}</pre>;
}`;

export default function ClickHouseNextJsPage() {
  return (
    <ClickhousePillarPage
      eyebrow="ClickHouse Next.js"
      title="Build ClickHouse analytics into Next.js without duplicating query logic"
      description="This page is about the App Router split: some analytics should run directly in server components, some should be exposed to browser clients, and you do not want those two paths to invent different versions of the same query."
      primaryCta={{ href: '/docs/nextjs', label: 'Open the Next.js guide' }}
      secondaryCta={{ href: '/blog/building-dashboards-clickhouse-hypequery-nextjs', label: 'Read the dashboard article' }}
      stats={[
        { label: 'Framework fit', value: 'Next.js App Router' },
        { label: 'Execution model', value: 'Local or HTTP' },
        { label: 'Best for', value: 'Dashboards and product analytics' },
      ]}
      problems={[
        {
          title: 'App Router makes it easy to fork the same query',
          copy:
            'A metric often starts in a server component, then gets copied into a route handler for client-side refresh, then appears again in another page. Next.js makes both paths easy, which is exactly why they drift.',
        },
        {
          title: 'Server and browser consumers need different delivery',
          copy:
            'The server can call code directly. The browser cannot. The awkward part is keeping those two access modes aligned without rewriting the query for each one.',
        },
        {
          title: 'Route files become accidental analytics files',
          copy:
            'If the only reusable unit is a loose SQL string, route files and page files start accumulating validation, parsing, and analytics logic that should live elsewhere.',
        },
      ]}
      solutionSection={{
        eyebrow: 'The App Router shape',
        title: 'Keep the query definition outside the route and page files',
        description:
          'The cleanest Next.js setup is one shared query definition plus two delivery paths: local execution for server code and a thin App Router handler for browser consumers.',
        bullets: [
          'Generate schema types from your ClickHouse database',
          'Define reusable analytics queries in TypeScript',
          'Mount the same API under app/api/* with createFetchHandler',
          'Run those queries directly in server components and actions',
          'Add React hooks later without changing the server contract',
        ],
        codePanel: {
          eyebrow: 'App Router',
          title: 'One route file that stays thin',
          description:
            'The route exists to expose the query, not to become the place where the query is authored.',
          code: routeCode,
        },
      }}
      implementationSection={{
        eyebrow: 'Server-first usage',
        title: 'Run local in server code, use HTTP only where the browser needs it',
        description:
          'The big advantage of Next.js is that not every query needs to go through the network. Use direct execution in server components by default, and reserve HTTP for interactive client-side flows.',
        paragraphs: [
          'That server-first split is what makes this page different from the React page. The React page starts at the client hook layer. This page starts at the question of whether the query should leave the server at all.',
          'If browser hooks are the main concern, continue to the React page. If the concern is general backend reuse outside Next.js, use the Node.js page.',
        ],
        codePanel: {
          eyebrow: 'Server component',
          title: 'A server component calling the shared query directly',
          description:
            'The component gets the data without a self-HTTP call, but it is still using the same analytics definition the browser path can expose later.',
          code: serverCode,
        },
      }}
      searchIntentCards={[
        {
          title: 'What this page is really answering',
          copy:
            'Not just how to connect ClickHouse to Next.js, but where query logic should live when the framework gives you both server and client execution paths.',
        },
        {
          title: 'Where the duplication usually starts',
          copy:
            'Usually when a server-rendered dashboard later needs client refresh or filtering and teams copy the query into a route instead of exposing the shared definition cleanly.',
        },
        {
          title: 'Why App Router changes the advice',
          copy:
            'Because you can often skip HTTP inside the app itself. That is why the local-vs-HTTP split matters more here than on the generic REST page.',
        },
        {
          title: 'Where to go next',
          copy:
            'Use the React page when the client hook layer is the next problem, not the current one.',
        },
      ]}
      readingLinks={[
        {
          href: '/blog/building-dashboards-clickhouse-hypequery-nextjs',
          title: 'Building dashboards on ClickHouse with hypequery and Next.js',
          description: 'The practical dashboard-oriented companion to this pillar page.',
        },
        {
          href: '/docs/nextjs',
          title: 'Next.js documentation guide',
          description: 'The implementation path for App Router handlers, local execution, and dev docs.',
        },
        {
          href: '/clickhouse-react',
          title: 'ClickHouse React',
          description: 'Continue into typed hooks and client-side data access patterns.',
        },
        {
          href: '/clickhouse-analytics',
          title: 'ClickHouse analytics',
          description: 'Step back and evaluate the broader analytics-layer architecture.',
        },
      ]}
      relatedPillars={[
        { href: '/clickhouse-react', label: 'ClickHouse React' },
        { href: '/clickhouse-typescript', label: 'ClickHouse TypeScript' },
        { href: '/clickhouse-analytics', label: 'ClickHouse Analytics' },
        { href: '/clickhouse-multi-tenant-analytics', label: 'ClickHouse Multi-Tenant Analytics' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Start with the Next.js recipe, then layer in React hooks where they help',
        description:
          'Get the App Router setup correct first. After that, decide which analytics belong in server components and which need a browser-facing client layer.',
        primaryCta: { href: '/docs/nextjs', label: 'Open Next.js docs' },
        secondaryCta: { href: '/clickhouse-react', label: 'See the React guide' },
      }}
    />
  );
}
