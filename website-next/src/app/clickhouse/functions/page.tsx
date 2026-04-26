import type { Metadata } from 'next';
import Link from 'next/link';
import Navigation from '@/components/Navigation';
import Footer from '@/components/Footer';
import { absoluteUrl } from '@/lib/site';
import { clickhouseFunctions, functionsByCluster } from '@/data/clickhouse-functions';

export const metadata: Metadata = {
  title: 'ClickHouse Functions — TypeScript Reference with hypequery',
  description:
    'Complete TypeScript reference for ClickHouse functions: date functions (toStartOfDay, toStartOfInterval), aggregate functions (uniq, quantile), string, conditional, and math functions — with hypequery examples.',
  alternates: { canonical: absoluteUrl('/clickhouse/functions') },
  openGraph: {
    type: 'website',
    url: absoluteUrl('/clickhouse/functions'),
    title: 'ClickHouse Functions — TypeScript Reference with hypequery',
    description:
      'TypeScript examples for every major ClickHouse function. Date bucketing, aggregate analytics, conditionals, and string manipulation — all with hypequery typed queries.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClickHouse Functions — TypeScript Reference with hypequery',
    description:
      'TypeScript reference for ClickHouse date, aggregate, string, conditional, and math functions with hypequery examples.',
  },
};

const clusterLabel: Record<string, string> = {
  date: 'Date Functions',
  aggregate: 'Aggregate Functions',
  string: 'String Functions',
  conditional: 'Conditional Functions',
  math: 'Math Functions',
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
};

const clusterColor: Record<string, string> = {
  date: 'text-cyan-300',
  aggregate: 'text-indigo-300',
  string: 'text-emerald-300',
  conditional: 'text-amber-300',
  math: 'text-rose-300',
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'CollectionPage',
  name: 'ClickHouse Functions — TypeScript Reference',
  description:
    'TypeScript reference pages for ClickHouse functions grouped by category: date, aggregate, string, conditional, and math.',
  url: absoluteUrl('/clickhouse/functions').toString(),
  hasPart: clickhouseFunctions.map((fn) => ({
    '@type': 'TechArticle',
    headline: fn.metaTitle,
    url: absoluteUrl(`/clickhouse/functions/${fn.slug}`).toString(),
  })),
};

export default function ClickHouseFunctionsIndexPage() {
  const clusters = ['date', 'aggregate', 'string', 'conditional', 'math'] as const;

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
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-indigo-300">
              ClickHouse Functions
            </p>
            <h1 className="font-display mt-4 max-w-4xl text-4xl font-semibold tracking-tight text-white sm:text-6xl">
              ClickHouse function reference for TypeScript developers
            </h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-300">
              Every ClickHouse function you use for analytics — date bucketing, aggregation, string manipulation —
              with TypeScript examples using hypequery. Generated schema, typed results, no manual interfaces.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link
                href="/docs/quick-start"
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
                <p className="mt-2 text-xl font-semibold text-slate-100">{clickhouseFunctions.length}+</p>
              </div>
              <div className="border border-slate-700/80 bg-slate-950/70 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Clusters</p>
                <p className="mt-2 text-xl font-semibold text-slate-100">Date · Aggregate · String · Math</p>
              </div>
              <div className="border border-slate-700/80 bg-slate-950/70 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Each page includes</p>
                <p className="mt-2 text-xl font-semibold text-slate-100">SQL + TypeScript examples</p>
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
              <h2 className="font-display mt-3 text-2xl font-semibold text-white">{clusterDescription[cluster]}</h2>
              <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {fns.map((fn) => (
                  <Link
                    key={fn.slug}
                    href={`/clickhouse/functions/${fn.slug}`}
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

        {/* CTA */}
        <section className="mx-auto max-w-7xl px-4 pb-20 lg:px-6">
          <div className="border border-indigo-500/35 bg-slate-950 p-8 md:flex md:items-center md:justify-between md:gap-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-indigo-300">Get started</p>
              <h2 className="font-display mt-3 text-2xl font-semibold text-white">
                Use any ClickHouse function with full TypeScript types
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">
                hypequery generates a TypeScript schema from your live ClickHouse database. Every function in this
                reference works in hypequery queries — with typed results, IDE autocomplete, and zero manual
                interface definitions.
              </p>
            </div>
            <div className="mt-6 flex gap-3 md:mt-0">
              <Link
                href="/docs/quick-start"
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
