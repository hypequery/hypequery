import type { Metadata } from 'next';
import Link from 'next/link';
import Navigation from '@/components/Navigation';
import Footer from '@/components/Footer';
import CodeWindow from '@/components/CodeWindow';
import { absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'ClickHouse with TypeScript: Type-Safe Queries and APIs | hypequery',
  description:
    'Use ClickHouse with TypeScript without hand-written interfaces. Generate schema types, build typed queries, and reuse them across APIs, jobs, and dashboards.',
  alternates: {
    canonical: absoluteUrl('/clickhouse-typescript'),
  },
  openGraph: {
    type: 'website',
    url: absoluteUrl('/clickhouse-typescript'),
    title: 'ClickHouse with TypeScript: Type-Safe Queries and APIs | hypequery',
    description:
      'Build ClickHouse backends in TypeScript with generated schema types, typed queries, reusable analytics definitions, and cleaner delivery paths.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClickHouse with TypeScript: Type-Safe Queries and APIs | hypequery',
    description:
      'Use ClickHouse with TypeScript through generated schema types, typed queries, and reusable analytics APIs.',
  },
};

const schemaCode = `npx hypequery generate --output analytics/schema.ts`;

const queryCode = `const { query, serve } = initServe({
  context: () => ({ db }),
});

const revenueByDay = query({
  input: z.object({
    startDate: z.string(),
    endDate: z.string(),
  }),
  query: async ({ ctx, input }) => {
    return ctx.db
      .table('orders')
      .where('created_at', 'gte', input.startDate)
      .where('created_at', 'lte', input.endDate)
      .groupBy(['day'])
      .sum('total', 'revenue')
      .execute();
  },
});

const api = serve({
  queries: { revenueByDay },
});

api.route('/revenue-by-day', api.queries.revenueByDay, { method: 'POST' });`;

const problems = [
  {
    title: 'ClickHouse types do not map cleanly to JavaScript',
    copy:
      'DateTime values come back as strings, UInt64 values often need to stay strings, and Nullable columns return null. If you hand-write TypeScript interfaces, TypeScript trusts the wrong types.',
  },
  {
    title: 'Raw SQL strings do not scale across a product codebase',
    copy:
      'The same analytics query ends up duplicated in API routes, background jobs, dashboards, and internal tools. Refactors become fragile because the query contract is spread across string literals.',
  },
  {
    title: 'Most teams end up rebuilding the same analytics layer',
    copy:
      'Once a ClickHouse project grows, teams want generated schema types, reusable query definitions, typed APIs, and a clean way to share analytics logic between backend and frontend.',
  },
];

const benefits = [
  'Generate TypeScript schema types from your live ClickHouse database',
  'Build type-safe ClickHouse queries without hand-maintained interfaces',
  'Reuse the same analytics definitions across APIs, jobs, and dashboards',
  'Expose typed HTTP endpoints with request and response schemas',
  'Keep ClickHouse runtime types aligned with your TypeScript codebase',
];

const comparisonLinks = [
  {
    href: '/blog/clickhouse-typescript-type-problem',
    title: 'The ClickHouse TypeScript type problem',
    description: 'A deep dive into the runtime type mismatches that bite TypeScript teams on ClickHouse.',
  },
  {
    href: '/compare/hypequery-vs-clickhouse-client',
    title: 'hypequery vs @clickhouse/client',
    description: 'What you actually gain when you move from raw queries to generated schema types and reusable query definitions.',
  },
  {
    href: '/compare/hypequery-vs-kysely',
    title: 'hypequery vs Kysely',
    description: 'Where Kysely is excellent, where ClickHouse changes the tradeoffs, and when hypequery is the better fit.',
  },
  {
    href: '/drizzle-clickhouse',
    title: 'Drizzle ORM for ClickHouse',
    description: 'For teams searching for Drizzle ORM support on ClickHouse and the closest TypeScript-native alternative.',
  },
];

const ecosystemLinks = [
  {
    href: '/clickhouse-nextjs',
    title: 'ClickHouse Next.js',
    description: 'How to reuse typed analytics queries across App Router handlers and server components.',
  },
  {
    href: '/clickhouse-react',
    title: 'ClickHouse React',
    description: 'How to turn a typed analytics API into React hooks for interactive dashboards.',
  },
  {
    href: '/clickhouse-analytics',
    title: 'ClickHouse Analytics',
    description: 'Why schema-driven query definitions become an analytics layer, not just a query builder.',
  },
  {
    href: '/clickhouse-multi-tenant-analytics',
    title: 'ClickHouse Multi-Tenant Analytics',
    description: 'How to apply tenant isolation when ClickHouse powers customer-facing analytics features.',
  },
];

export default function ClickHouseTypeScriptPage() {
  return (
    <>
      <Navigation />
      <main className="min-h-screen bg-bg pt-28 text-text">
        <section className="relative overflow-hidden border-b border-border">
          <div className="relative mx-auto max-w-7xl px-4 py-20 lg:px-6">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-accent">
              ClickHouse TypeScript
            </p>
            <h1 className="font-display mt-4 max-w-5xl text-4xl font-semibold tracking-tight text-text sm:text-6xl">
              ClickHouse with TypeScript
            </h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-text-muted">
              The annoying part of using ClickHouse from TypeScript is not writing SQL. It is keeping runtime types, query code, and API surfaces aligned as the codebase grows. hypequery gives you generated schema types and a reusable query layer so that work does not keep getting rebuilt by hand.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link
                href="/docs/quick-start"
                className="bg-text px-6 py-3 text-sm font-semibold text-bg transition hover:opacity-90"
              >
                Start with hypequery
              </Link>
              <Link
                href="/clickhouse-schema"
                className="border border-border-strong px-6 py-3 text-sm font-semibold text-text transition hover:bg-bg-alt"
              >
                Generate schema types
              </Link>
            </div>
            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              <div className="rounded-lg border border-border bg-bg-card p-5 shadow-card">
                <p className="text-xs uppercase tracking-[0.2em] text-text-dim">Core benefit</p>
                <p className="mt-2 text-xl font-semibold text-text">Generated schema types</p>
              </div>
              <div className="rounded-lg border border-border bg-bg-card p-5 shadow-card">
                <p className="text-xs uppercase tracking-[0.2em] text-text-dim">Execution model</p>
                <p className="mt-2 text-xl font-semibold text-text">Local or HTTP</p>
              </div>
              <div className="rounded-lg border border-border bg-bg-card p-5 shadow-card">
                <p className="text-xs uppercase tracking-[0.2em] text-text-dim">Best fit</p>
                <p className="mt-2 text-xl font-semibold text-text">Analytics-heavy TypeScript apps</p>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-16 lg:px-6">
          <div className="grid gap-6 lg:grid-cols-3">
            {problems.map((problem) => (
              <div key={problem.title} className="rounded-lg border border-border bg-bg-card p-6 shadow-card">
                <h2 className="font-display text-xl font-semibold text-text">{problem.title}</h2>
                <p className="mt-4 text-sm leading-7 text-text-muted">{problem.copy}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-y border-border bg-bg-alt/60">
          <div className="mx-auto max-w-7xl px-4 py-16 lg:px-6">
            <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr]">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-accent">
                  How hypequery helps
                </p>
              <h2 className="font-display mt-3 text-3xl font-semibold text-text">
                A ClickHouse TypeScript workflow built for reusable analytics
              </h2>
              <p className="mt-5 text-base leading-8 text-text-muted">
                Instead of hand-writing TypeScript interfaces and copying SQL into route handlers, jobs, and dashboards, you generate schema types from ClickHouse and define the query once. That definition can run locally or be served over HTTP without drifting from the source query.
              </p>
                <ul className="mt-8 space-y-3 text-sm text-text">
                  {benefits.map((benefit) => (
                    <li key={benefit} className="flex gap-3">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                      <span>{benefit}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-lg border border-border bg-bg-card p-6 shadow-card">
                <p className="text-xs uppercase tracking-[0.25em] text-text-dim">Step 1</p>
                <h3 className="font-display mt-3 text-xl font-semibold text-text">
                  Generate schema types from ClickHouse
                </h3>
                <CodeWindow code={schemaCode} filename="generate-schema.sh" language="bash" className="mt-4" />
                <p className="mt-4 text-sm leading-7 text-text-muted">
                  This is where the ClickHouse TypeScript workflow becomes reliable. Runtime types like
                  `DateTime`, `UInt64`, `Nullable`, and `Decimal` get mapped correctly instead of being guessed.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-16 lg:px-6">
          <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr]">
            <div>
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-accent">
                Step 2
              </p>
              <h2 className="font-display mt-3 text-3xl font-semibold text-text">
                Define typed ClickHouse queries once
              </h2>
              <p className="mt-5 text-base leading-8 text-text-muted">
                hypequery lets you model analytics queries in TypeScript and reuse them across product surfaces.
                That means the same query definition can power a dashboard, an API route, a job, or an internal tool
                without duplicating logic.
              </p>
              <div className="mt-8 space-y-4 text-sm leading-7 text-text-muted">
                <p>
                  This is the difference between “ClickHouse client in TypeScript” and a real ClickHouse analytics
                  backend in TypeScript. You are not just running queries. You are defining typed contracts that can
                  be reused safely.
                </p>
                <p>
                  If you want the shortest path to a working setup, skip the comparison content and <Link href="/docs/quick-start" className="text-accent hover:opacity-70">start with hypequery now</Link>. One real query against your own schema will tell you more than another hour of reading.
                </p>
                <p>
                  If your team is comparing options, read <Link href="/compare/hypequery-vs-clickhouse-client" className="text-accent hover:opacity-70">hypequery vs @clickhouse/client</Link>, <Link href="/compare/hypequery-vs-kysely" className="text-accent hover:opacity-70">hypequery vs Kysely</Link>, and <Link href="/drizzle-clickhouse" className="text-accent hover:opacity-70">Drizzle ORM for ClickHouse</Link> after this page.
                </p>
              </div>
            </div>
            <div className="rounded-lg border border-border bg-bg-card p-6 shadow-card">
              <CodeWindow code={queryCode} filename="analytics-api.ts" className="mt-0" />
            </div>
          </div>
        </section>

        <section className="border-y border-border bg-bg-alt/60">
          <div className="mx-auto max-w-7xl px-4 py-16 lg:px-6">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-text-dim">Why teams search for this</p>
            <h2 className="font-display mt-3 text-3xl font-semibold text-text">
              Common ClickHouse TypeScript problems this page should solve
            </h2>
            <div className="mt-10 grid gap-6 md:grid-cols-2">
              <div className="rounded-lg border border-border bg-bg-card p-6 shadow-card">
                <h3 className="font-display text-xl font-semibold text-text">
                  ClickHouse query builder for TypeScript
                </h3>
                <p className="mt-3 text-sm leading-7 text-text-muted">
                  If you want a ClickHouse query builder with real TypeScript support, the key question is not just syntax.
                  It is whether the builder understands ClickHouse runtime types and can be reused across your app.
                </p>
              </div>
              <div className="rounded-lg border border-border bg-bg-card p-6 shadow-card">
                <h3 className="font-display text-xl font-semibold text-text">
                  ClickHouse types in TypeScript
                </h3>
                <p className="mt-3 text-sm leading-7 text-text-muted">
                  DateTime, UInt64, Decimal, and Nullable columns are where most silent bugs start. If that is your main
                  pain point, read <Link href="/blog/clickhouse-typescript-type-problem" className="text-accent hover:opacity-70">the type problem guide</Link>.
                </p>
              </div>
              <div className="rounded-lg border border-border bg-bg-card p-6 shadow-card">
                <h3 className="font-display text-xl font-semibold text-text">
                  Reusable analytics APIs in TypeScript
                </h3>
                <p className="mt-3 text-sm leading-7 text-text-muted">
                  Teams often start with raw queries and then realize they need typed APIs, internal analytics services,
                  or OpenAPI docs on top. hypequery is optimized for that step-up in complexity.
                </p>
              </div>
              <div className="rounded-lg border border-border bg-bg-card p-6 shadow-card">
                <h3 className="font-display text-xl font-semibold text-text">
                  Alternatives to hand-written query types
                </h3>
                <p className="mt-3 text-sm leading-7 text-text-muted">
                  Hand-maintained interfaces drift. Generated schema types plus typed query definitions remove that drift
                  from the system instead of relying on discipline alone.
                </p>
              </div>
              <div className="rounded-lg border border-border bg-bg-card p-6 shadow-card">
                <h3 className="font-display text-xl font-semibold text-text">
                  How do I use ClickHouse with TypeScript?
                </h3>
                <p className="mt-3 text-sm leading-7 text-text-muted">
                  Start by introspecting the live schema. Generate TypeScript types from that schema. Build queries against those types. Then decide where the query needs to run: inline, behind an endpoint, or in a dashboard. That is the workflow hypequery makes easier.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-16 lg:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-accent">Further reading</p>
          <h2 className="font-display mt-3 text-3xl font-semibold text-text">
            Compare approaches and go deeper
          </h2>
          <div className="mt-10 grid gap-6 lg:grid-cols-3">
            {comparisonLinks.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="group rounded-lg border border-border bg-bg-card p-6 transition hover:-translate-y-1 hover:border-border-strong hover:shadow-card"
              >
                <h3 className="font-display text-xl font-semibold text-text">{item.title}</h3>
                <p className="mt-3 text-sm leading-7 text-text-muted">{item.description}</p>
                <p className="mt-6 text-xs font-semibold uppercase tracking-[0.2em] text-accent group-hover:opacity-70">
                  Open article
                </p>
              </Link>
            ))}
          </div>
          <div className="mt-12 grid gap-6 lg:grid-cols-4">
            {ecosystemLinks.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="group rounded-lg border border-border bg-bg-card p-5 transition hover:border-border-strong hover:shadow-card"
              >
                <h3 className="font-display text-lg font-semibold text-text">{item.title}</h3>
                <p className="mt-3 text-sm leading-7 text-text-muted">{item.description}</p>
              </Link>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-20 lg:px-6">
          <div className="rounded-lg border border-border-strong bg-bg-card p-8 shadow-card md:flex md:items-center md:justify-between md:gap-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-accent">
                Next step
              </p>
              <h2 className="font-display mt-3 text-2xl font-semibold text-text">
                Start with hypequery on one real ClickHouse query
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-text-muted">
                Generate schema types, define your first typed query, and prove the workflow on your actual ClickHouse schema before expanding further.
              </p>
            </div>
            <div className="mt-6 flex gap-3 md:mt-0">
              <Link
                href="/docs/quick-start"
                className="inline-flex items-center bg-text px-5 py-3 text-sm font-semibold text-bg transition hover:opacity-90"
              >
                Start with hypequery
              </Link>
              <Link
                href="/clickhouse-schema"
                className="inline-flex items-center border border-border-strong px-5 py-3 text-sm font-semibold text-text transition hover:bg-bg-alt"
              >
                Generate schema types
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
