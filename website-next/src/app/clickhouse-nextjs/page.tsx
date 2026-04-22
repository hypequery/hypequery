import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'ClickHouse Next.js',
  description:
    'Build ClickHouse analytics into Next.js with shared typed queries, App Router handlers, server component execution, and React-friendly data access.',
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
      description="Use hypequery to define a ClickHouse query once, run it inside App Router server components, and expose the same contract over HTTP for browser clients. This is the clean path for analytics-heavy Next.js apps."
      primaryCta={{ href: '/docs/nextjs', label: 'Open the Next.js guide' }}
      secondaryCta={{ href: '/blog/building-dashboards-clickhouse-hypequery-nextjs', label: 'Read the dashboard article' }}
      stats={[
        { label: 'Framework fit', value: 'Next.js App Router' },
        { label: 'Execution model', value: 'Local or HTTP' },
        { label: 'Best for', value: 'Dashboards and product analytics' },
      ]}
      problems={[
        {
          title: 'Analytics logic drifts across routes and components',
          copy:
            'Teams often write one query in an API route, another in a server component, and a third in a cron job. The logic slowly diverges and debugging becomes guesswork.',
        },
        {
          title: 'Next.js developers need both server-side and browser access',
          copy:
            'Some analytics belong in server components or actions, while other screens need typed browser fetching. You need one definition that can serve both paths.',
        },
        {
          title: 'Raw ClickHouse clients leave too much wiring to the app team',
          copy:
            'You still need request validation, handler setup, and a reusable query layer that fits naturally into App Router instead of living as loose SQL strings.',
        },
      ]}
      solutionSection={{
        eyebrow: 'Why this stack works',
        title: 'Use one typed query definition across the whole Next.js runtime',
        description:
          'hypequery gives a Next.js team a stable analytics contract: typed ClickHouse queries, an App Router handler, and direct in-process execution when HTTP is unnecessary.',
        bullets: [
          'Generate schema types from your ClickHouse database',
          'Define reusable analytics queries in TypeScript',
          'Mount the same API under app/api/* with createFetchHandler',
          'Run those queries directly in server components and actions',
          'Add React hooks later without changing the server contract',
        ],
        codePanel: {
          eyebrow: 'App Router',
          title: 'Mount a typed analytics handler once',
          description:
            'This keeps your HTTP surface thin. The real analytics logic lives in shared query definitions, not inside the route file.',
          code: routeCode,
        },
      }}
      implementationSection={{
        eyebrow: 'Server-first usage',
        title: 'Prefer local execution in server components, use HTTP for browser consumers',
        description:
          'A strong Next.js setup does not force every analytics request through HTTP. Server code can call the query directly, while client-side charts can hit the same query through typed endpoints.',
        paragraphs: [
          'This split is especially useful for dashboards. Server components can render the initial state with low overhead, and interactive client components can progressively refetch via HTTP only where needed.',
          'If React hooks are part of the plan, the dedicated ClickHouse React pillar and the React docs are the natural next step after this page.',
        ],
        codePanel: {
          eyebrow: 'Server component',
          title: 'Run the same query in-process',
          description:
            'You avoid network overhead inside the same app process while keeping the exact same validation and query definition.',
          code: serverCode,
        },
      }}
      searchIntentCards={[
        {
          title: 'ClickHouse Next.js App Router setup',
          copy:
            'If you are searching for how to connect ClickHouse to App Router, the real answer is not just connection code. It is deciding which analytics stay local and which become reusable HTTP endpoints.',
        },
        {
          title: 'Next.js analytics dashboard architecture',
          copy:
            'Dashboards usually need SSR, client hydration, and typed re-fetching. A shared query layer stops those concerns from creating three versions of the same metric.',
        },
        {
          title: 'ClickHouse API routes in Next.js',
          copy:
            'You can expose typed analytics endpoints under `app/api/*` without hand-writing validation or response contracts for each route.',
        },
        {
          title: 'When to add React hooks',
          copy:
            'Use direct execution for server code first. Add hooks when browser-side interactivity needs cache-aware fetching and mutation ergonomics.',
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
