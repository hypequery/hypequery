import type { Metadata } from 'next';
import Link from 'next/link';
import Navigation from '@/components/Navigation';
import Footer from '@/components/Footer';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { absoluteUrl, ogImage } from '@/lib/site';
import { clickhouseFunctions, functionPathSegment, functionsByCluster } from '@/data/clickhouse-functions';

export const metadata: Metadata = {
  title: 'ClickHouse Functions — TypeScript Examples',
  description:
    'Curated TypeScript examples for common ClickHouse functions: date functions, aggregates, strings, conditionals, and math — with hypequery query-builder examples.',
  alternates: { canonical: absoluteUrl('/clickhouse/functions') },
  openGraph: {
    images: ogImage('ClickHouse Functions — TypeScript Examples'),
    type: 'website',
    url: absoluteUrl('/clickhouse/functions'),
    title: 'ClickHouse Functions — TypeScript Examples with hypequery',
    description:
      'TypeScript examples for common ClickHouse analytics functions. Date bucketing, aggregates, conditionals, and string manipulation with hypequery queries.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClickHouse Functions — TypeScript Examples with hypequery',
    description:
      'TypeScript examples for ClickHouse date, aggregate, string, conditional, and math functions with hypequery.',
  },
};

const clusterLabel: Record<string, string> = {
  date: 'Date Functions',
  aggregate: 'Aggregate Functions',
  string: 'String Functions',
  conditional: 'Conditional Functions',
  math: 'Math Functions',
  array: 'Array Functions',
};

const clusterDescription: Record<string, string> = {
  date:
    'Date and time functions for bucketing, truncating, and formatting timestamps — the foundation of every ClickHouse analytics query.',
  aggregate:
    'Aggregate functions for counting, summing, averaging, and estimating cardinality across millions of rows.',
  string: 'String manipulation functions for formatting display values, parsing, and building composite keys.',
  conditional:
    'Conditional expressions for inline branching, NULL handling, and multi-way value selection.',
  math: 'Math functions for rounding, integer arithmetic, and numeric bucketing.',
  array:
    'Array functions for transforming, filtering, and unnesting array columns — including higher-order functions with lambda expressions.',
};

const clusterColor: Record<string, string> = {
  date: 'text-cyan-300',
  aggregate: 'text-indigo-300',
  string: 'text-emerald-300',
  conditional: 'text-amber-300',
  math: 'text-rose-300',
  array: 'text-violet-300',
};

const beyondFunctionsLinks = [
  {
    href: '/compare/hypequery-vs-raw-sql',
    title: 'Raw SQL strings vs a typed builder',
    description: 'When to keep a function call in a SQL string, and when a schema-checked query catches renamed columns.',
  },
  {
    href: '/compare/hypequery-vs-clickhouse-connect',
    title: 'Python: hypequery vs clickhouse-connect',
    description: 'Run these functions from Python with the official driver, or as shared, typed measures.',
  },
  {
    href: '/docs/nextjs',
    title: 'Serve queries from Next.js',
    description: 'Mount typed ClickHouse queries in a Next.js App Router project.',
  },
  {
    href: '/docs/fetch',
    title: 'Serve queries from any Fetch runtime',
    description: 'Hono, Cloudflare Workers, Bun, Deno, React Router and SvelteKit.',
  },
  {
    href: '/docs/embedded-runtime',
    title: 'Embedded runtime',
    description: 'Run query definitions inside your own application process, with no separate server.',
  },
  {
    href: '/compare/cube-vs-tinybird-vs-hypequery',
    title: 'Cube vs Tinybird vs hypequery',
    description: 'Three ways to put an API layer between ClickHouse and your application.',
  },
] as const;

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'CollectionPage',
  name: 'ClickHouse Functions — TypeScript Examples',
  description:
    'TypeScript example pages for common ClickHouse functions grouped by category: date, aggregate, string, conditional, and math.',
  url: absoluteUrl('/clickhouse/functions').toString(),
  hasPart: clickhouseFunctions.map((fn) => ({
    '@type': 'TechArticle',
    headline: fn.metaTitle,
    url: absoluteUrl(`/clickhouse/functions/${functionPathSegment(fn.name)}`).toString(),
  })),
};

export default function ClickHouseFunctionsIndexPage() {
  const clusters = ['date', 'aggregate', 'string', 'conditional', 'math', 'array'] as const;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Navigation />
      <main className="min-h-screen bg-[#020617] pt-28 text-gray-100">
        {/* Hero */}
        <section className="relative overflow-hidden border-b border-slate-800/80">
          <div className="relative mx-auto max-w-7xl px-4 py-20 lg:px-6">
            <Breadcrumbs
              items={[{ label: 'ClickHouse', href: '/clickhouse' }, { label: 'Functions' }]}
              currentPath="/clickhouse/functions"
              className="text-slate-400"
            />
            <p className="mt-6 text-xs font-semibold uppercase tracking-[0.3em] text-indigo-300">
              ClickHouse Functions
            </p>
            <h1 className="mt-4 max-w-4xl text-4xl font-semibold tracking-tight text-white sm:text-6xl">
              ClickHouse function reference for TypeScript developers
            </h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-300">
              A curated set of common ClickHouse functions for analytics, with SQL and hypequery examples for date
              bucketing, aggregation, string manipulation, conditionals, and numeric bucketing.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link
                href="/docs/quick-start"
                data-umami-event="cta_click"
                data-umami-event-target="docs_quick_start"
                data-umami-event-location="hero_primary"
                className="bg-indigo-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500"
              >
                Quick start
              </Link>
              <Link
                href="/clickhouse-typescript"
                className="border border-slate-600 px-6 py-3 text-sm font-semibold text-slate-100 transition hover:bg-white/10"
              >
                ClickHouse TypeScript guide
              </Link>
            </div>
            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              <div className="border border-slate-700/80 bg-slate-950/70 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Functions covered</p>
                <p className="mt-2 text-xl font-semibold text-slate-100">{clickhouseFunctions.length}</p>
              </div>
              <div className="border border-slate-700/80 bg-slate-950/70 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Clusters</p>
                <p className="mt-2 text-xl font-semibold text-slate-100">Date · Aggregate · String · Conditional · Math</p>
              </div>
              <div className="border border-slate-700/80 bg-slate-950/70 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Each page includes</p>
                <p className="mt-2 text-xl font-semibold text-slate-100">SQL + query-builder examples</p>
              </div>
            </div>
          </div>
        </section>

        {/* Function clusters */}
        {clusters.map((cluster) => {
          const fns = functionsByCluster[cluster];
          if (!fns || fns.length === 0) return null;
          return (
            <section key={cluster} className="mx-auto max-w-7xl px-4 py-14 lg:px-6">
              <p className={`text-xs font-semibold uppercase tracking-[0.3em] ${clusterColor[cluster]}`}>
                {clusterLabel[cluster]}
              </p>
              <h2 className="mt-3 text-2xl font-semibold text-white">{clusterDescription[cluster]}</h2>
              <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {fns.map((fn) => (
                  <Link
                    key={fn.slug}
                    href={`/clickhouse/functions/${functionPathSegment(fn.name)}`}
                    className="group border border-slate-700 bg-slate-900/70 p-5 transition hover:-translate-y-1 hover:border-indigo-400 hover:bg-slate-900"
                  >
                    <code className={`font-mono text-base font-semibold ${clusterColor[cluster]}`}>
                      {fn.name}()
                    </code>
                    <p className="mt-2 text-sm leading-6 text-slate-300">{fn.tagline}</p>
                    <p className="mt-4 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 group-hover:text-cyan-300 transition">
                      View reference →
                    </p>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}

        {/* Beyond single functions */}
        <section className="mx-auto max-w-7xl px-4 pb-14 lg:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Beyond single functions</p>
          <h2 className="mt-3 text-2xl font-semibold text-white">Put these functions into typed queries and APIs</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {beyondFunctionsLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="group border border-slate-700 bg-slate-900/70 p-5 transition hover:-translate-y-1 hover:border-indigo-400 hover:bg-slate-900"
              >
                <p className="text-base font-semibold text-white">{link.title}</p>
                <p className="mt-2 text-sm leading-6 text-slate-300">{link.description}</p>
              </Link>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto max-w-7xl px-4 pb-20 lg:px-6">
          <div className="border border-indigo-500/35 bg-slate-950 p-8 md:flex md:items-center md:justify-between md:gap-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-indigo-300">Get started</p>
              <h2 className="mt-3 text-2xl font-semibold text-white">
                Use common ClickHouse functions in typed TypeScript queries
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">
                hypequery generates a TypeScript schema from your live ClickHouse database. These examples show how to
                combine ClickHouse functions with the query builder, while using raw SQL expressions when the function
                is not wrapped by a dedicated helper.
              </p>
            </div>
            <div className="mt-6 flex gap-3 md:mt-0">
              <Link
                href="/docs/quick-start"
                data-umami-event="cta_click"
                data-umami-event-target="docs_quick_start"
                data-umami-event-location="next_step_primary"
                className="inline-flex items-center bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500"
              >
                Quick start
              </Link>
              <Link
                href="/clickhouse-typescript"
                className="inline-flex items-center border border-slate-600 px-5 py-3 text-sm font-semibold text-slate-100 transition hover:bg-slate-800"
              >
                TypeScript guide
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
