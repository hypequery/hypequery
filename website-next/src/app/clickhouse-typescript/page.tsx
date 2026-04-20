import type { Metadata } from 'next';
import Link from 'next/link';
import Navigation from '@/components/Navigation';
import Footer from '@/components/Footer';
import { absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'ClickHouse TypeScript',
  description:
    'Use ClickHouse with TypeScript without hand-written query types, raw SQL drift, or runtime schema mismatches. Build typed queries, APIs, and analytics backends with hypequery.',
  alternates: {
    canonical: absoluteUrl('/clickhouse-typescript'),
  },
  openGraph: {
    type: 'website',
    url: absoluteUrl('/clickhouse-typescript'),
    title: 'ClickHouse TypeScript | Type-Safe Queries, APIs, and Analytics',
    description:
      'Build ClickHouse backends in TypeScript with generated schema types, type-safe queries, reusable analytics definitions, and typed HTTP APIs.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClickHouse TypeScript | Type-Safe Queries, APIs, and Analytics',
    description:
      'Build ClickHouse backends in TypeScript with generated schema types, type-safe queries, reusable analytics definitions, and typed HTTP APIs.',
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
    href: '/blog/hypequery-vs-clickhouse-client',
    title: 'hypequery vs @clickhouse/client',
    description: 'What you actually gain when you move from raw queries to generated schema types and reusable query definitions.',
  },
  {
    href: '/blog/hypequery-vs-kysely',
    title: 'hypequery vs Kysely',
    description: 'Where Kysely is excellent, where ClickHouse changes the tradeoffs, and when hypequery is the better fit.',
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
      <main className="min-h-screen bg-[#020617] pt-28 text-gray-100">
        <section className="relative overflow-hidden border-b border-slate-800/80">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_15%,rgba(99,102,241,0.28),transparent_38%),radial-gradient(circle_at_78%_0%,rgba(14,165,233,0.2),transparent_32%)]" />
          <div className="relative mx-auto max-w-7xl px-4 py-20 lg:px-6">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-indigo-300">
              ClickHouse TypeScript
            </p>
            <h1 className="font-display mt-4 max-w-5xl text-4xl font-semibold tracking-tight text-white sm:text-6xl">
              Type-safe ClickHouse queries, APIs, and analytics backends in TypeScript
            </h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-300">
              hypequery helps teams use ClickHouse with TypeScript without hand-written schema interfaces,
              raw SQL drift, or runtime type mismatches. Generate schema types, define reusable analytics
              queries, and expose the same logic over HTTP.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link
                href="/docs/quick-start"
                className="bg-indigo-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500"
              >
                Start with the quick start
              </Link>
              <Link
                href="/blog/clickhouse-typescript-type-problem"
                className="border border-slate-600 px-6 py-3 text-sm font-semibold text-slate-100 transition hover:bg-white/10"
              >
                Read the type problem guide
              </Link>
            </div>
            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              <div className="border border-slate-700/80 bg-slate-950/70 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Core benefit</p>
                <p className="mt-2 text-xl font-semibold text-slate-100">Generated schema types</p>
              </div>
              <div className="border border-slate-700/80 bg-slate-950/70 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Execution model</p>
                <p className="mt-2 text-xl font-semibold text-slate-100">Local or HTTP</p>
              </div>
              <div className="border border-slate-700/80 bg-slate-950/70 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Best fit</p>
                <p className="mt-2 text-xl font-semibold text-slate-100">Analytics-heavy TypeScript apps</p>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-16 lg:px-6">
          <div className="grid gap-6 lg:grid-cols-3">
            {problems.map((problem) => (
              <div key={problem.title} className="border border-slate-700 bg-slate-900/60 p-6">
                <h2 className="font-display text-xl font-semibold text-slate-100">{problem.title}</h2>
                <p className="mt-4 text-sm leading-7 text-slate-300">{problem.copy}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-y border-slate-800 bg-slate-950/60">
          <div className="mx-auto max-w-7xl px-4 py-16 lg:px-6">
            <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr]">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-300">
                  How hypequery helps
                </p>
                <h2 className="font-display mt-3 text-3xl font-semibold text-white">
                  A ClickHouse TypeScript workflow built for reusable analytics
                </h2>
                <p className="mt-5 text-base leading-8 text-slate-300">
                  Instead of hand-writing TypeScript interfaces and duplicating raw SQL strings, you generate
                  schema types from ClickHouse and define analytics queries once. Those definitions can run
                  locally in-process or be served over HTTP with the same types.
                </p>
                <ul className="mt-8 space-y-3 text-sm text-slate-200">
                  {benefits.map((benefit) => (
                    <li key={benefit} className="flex gap-3">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300" />
                      <span>{benefit}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="border border-slate-700 bg-slate-950/80 p-6">
                <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Step 1</p>
                <h3 className="font-display mt-3 text-xl font-semibold text-white">
                  Generate schema types from ClickHouse
                </h3>
                <pre className="mt-4 overflow-x-auto border border-slate-800 bg-black/40 p-4 text-sm text-emerald-200">
                  <code>{schemaCode}</code>
                </pre>
                <p className="mt-4 text-sm leading-7 text-slate-300">
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
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-indigo-300">
                Step 2
              </p>
              <h2 className="font-display mt-3 text-3xl font-semibold text-white">
                Define typed ClickHouse queries once
              </h2>
              <p className="mt-5 text-base leading-8 text-slate-300">
                hypequery lets you model analytics queries in TypeScript and reuse them across product surfaces.
                That means the same query definition can power a dashboard, an API route, a job, or an internal tool
                without duplicating logic.
              </p>
              <div className="mt-8 space-y-4 text-sm leading-7 text-slate-300">
                <p>
                  This is the difference between “ClickHouse client in TypeScript” and a real ClickHouse analytics
                  backend in TypeScript. You are not just running queries. You are defining typed contracts that can
                  be reused safely.
                </p>
                <p>
                  If your team is comparing options, read <Link href="/blog/hypequery-vs-clickhouse-client" className="text-cyan-300 hover:text-cyan-200">hypequery vs @clickhouse/client</Link> and <Link href="/blog/hypequery-vs-kysely" className="text-cyan-300 hover:text-cyan-200">hypequery vs Kysely</Link> after this page.
                </p>
              </div>
            </div>
            <div className="border border-slate-700 bg-slate-950/80 p-6">
              <pre className="overflow-x-auto text-sm text-emerald-200">
                <code>{queryCode}</code>
              </pre>
            </div>
          </div>
        </section>

        <section className="border-y border-slate-800 bg-slate-950/60">
          <div className="mx-auto max-w-7xl px-4 py-16 lg:px-6">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Why teams search for this</p>
            <h2 className="font-display mt-3 text-3xl font-semibold text-white">
              Common ClickHouse TypeScript problems this page should solve
            </h2>
            <div className="mt-10 grid gap-6 md:grid-cols-2">
              <div className="border border-slate-700 bg-slate-900/70 p-6">
                <h3 className="font-display text-xl font-semibold text-slate-100">
                  ClickHouse query builder for TypeScript
                </h3>
                <p className="mt-3 text-sm leading-7 text-slate-300">
                  If you want a ClickHouse query builder with real TypeScript support, the key question is not just syntax.
                  It is whether the builder understands ClickHouse runtime types and can be reused across your app.
                </p>
              </div>
              <div className="border border-slate-700 bg-slate-900/70 p-6">
                <h3 className="font-display text-xl font-semibold text-slate-100">
                  ClickHouse types in TypeScript
                </h3>
                <p className="mt-3 text-sm leading-7 text-slate-300">
                  DateTime, UInt64, Decimal, and Nullable columns are where most silent bugs start. If that is your main
                  pain point, read <Link href="/blog/clickhouse-typescript-type-problem" className="text-cyan-300 hover:text-cyan-200">the type problem guide</Link>.
                </p>
              </div>
              <div className="border border-slate-700 bg-slate-900/70 p-6">
                <h3 className="font-display text-xl font-semibold text-slate-100">
                  Reusable analytics APIs in TypeScript
                </h3>
                <p className="mt-3 text-sm leading-7 text-slate-300">
                  Teams often start with raw queries and then realize they need typed APIs, internal analytics services,
                  or OpenAPI docs on top. hypequery is optimized for that step-up in complexity.
                </p>
              </div>
              <div className="border border-slate-700 bg-slate-900/70 p-6">
                <h3 className="font-display text-xl font-semibold text-slate-100">
                  Alternatives to hand-written query types
                </h3>
                <p className="mt-3 text-sm leading-7 text-slate-300">
                  Hand-maintained interfaces drift. Generated schema types plus typed query definitions remove that drift
                  from the system instead of relying on discipline alone.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-16 lg:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-indigo-300">Further reading</p>
          <h2 className="font-display mt-3 text-3xl font-semibold text-white">
            Compare approaches and go deeper
          </h2>
          <div className="mt-10 grid gap-6 lg:grid-cols-3">
            {comparisonLinks.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="group border border-slate-700 bg-slate-900/70 p-6 transition hover:-translate-y-1 hover:border-indigo-400 hover:bg-slate-900"
              >
                <h3 className="font-display text-xl font-semibold text-slate-100">{item.title}</h3>
                <p className="mt-3 text-sm leading-7 text-slate-300">{item.description}</p>
                <p className="mt-6 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300 group-hover:text-cyan-200">
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
                className="group border border-slate-700 bg-slate-900/50 p-5 transition hover:border-cyan-400 hover:bg-slate-900"
              >
                <h3 className="font-display text-lg font-semibold text-slate-100">{item.title}</h3>
                <p className="mt-3 text-sm leading-7 text-slate-300">{item.description}</p>
              </Link>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-20 lg:px-6">
          <div className="border border-indigo-500/35 bg-[linear-gradient(140deg,rgba(30,41,59,0.9),rgba(15,23,42,0.95))] p-8 md:flex md:items-center md:justify-between md:gap-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-indigo-300">
                Next step
              </p>
              <h2 className="font-display mt-3 text-2xl font-semibold text-white">
                Start with the ClickHouse TypeScript quick path
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">
                Generate schema types, define your first typed query, and then decide whether you want to run it
                locally or expose it over HTTP.
              </p>
            </div>
            <div className="mt-6 flex gap-3 md:mt-0">
              <Link
                href="/docs/quick-start"
                className="inline-flex items-center bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500"
              >
                Open quick start
              </Link>
              <Link
                href="/docs/schemas"
                className="inline-flex items-center border border-slate-600 px-5 py-3 text-sm font-semibold text-slate-100 transition hover:bg-slate-800"
              >
                Read schemas guide
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
