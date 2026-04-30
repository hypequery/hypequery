import type { Metadata } from 'next';
import Link from 'next/link';
import Navigation from '@/components/Navigation';
import Footer from '@/components/Footer';
import { comparePages } from '@/data/compare-pages';
import { absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Compare Hypequery',
  description:
    'Compare hypequery against the main ClickHouse TypeScript options and start from the tradeoff closest to your current stack.',
  alternates: {
    canonical: absoluteUrl('/compare'),
  },
  openGraph: {
    type: 'website',
    url: absoluteUrl('/compare'),
    title: 'Compare hypequery | ClickHouse TypeScript Tradeoffs',
    description:
      'Compare hypequery with the main ClickHouse TypeScript options and move quickly from evaluation into a real implementation test.',
  },
};

export default function CompareIndexPage() {
  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Compare',
        item: absoluteUrl('/compare').toString(),
      },
    ],
  };

  return (
    <>
      <Navigation />
      <main className="min-h-screen bg-[#020617] pt-28 text-gray-100">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />
        <section className="border-b border-slate-800/80">
          <div className="mx-auto max-w-7xl px-4 py-20 lg:px-6">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-indigo-300">Compare</p>
            <h1 className="font-display mt-4 max-w-5xl text-4xl font-semibold tracking-tight text-white sm:text-6xl">
              Compare hypequery against the main ClickHouse TypeScript options
            </h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-300">
              These pages are for teams trying to decide what to keep and what to replace. Start with the comparison that matches the tool or pattern you already use, then move into implementation only if the tradeoff is actually clear.
            </p>
            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              <div className="border border-slate-700/80 bg-slate-950/70 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Decision focus</p>
                <p className="mt-2 text-xl font-semibold text-slate-100">ClickHouse-first TypeScript teams</p>
              </div>
              <div className="border border-slate-700/80 bg-slate-950/70 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">What you get</p>
                <p className="mt-2 text-xl font-semibold text-slate-100">Tradeoffs, not feature checklists</p>
              </div>
              <div className="border border-slate-700/80 bg-slate-950/70 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Best next step</p>
                <p className="mt-2 text-xl font-semibold text-slate-100">Pick a path, then quick start</p>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-16 lg:px-6">
          <div className="mb-10 grid gap-6 md:grid-cols-3">
	            <div className="border border-slate-700 bg-slate-900/60 p-6">
	              <h2 className="font-display text-lg font-semibold text-slate-100">Built for real evaluations</h2>
	              <p className="mt-3 text-sm leading-7 text-slate-300">
	                Each page is written around the actual switch a team might make, not a generic feature checklist.
	              </p>
	            </div>
	            <div className="border border-slate-700 bg-slate-900/60 p-6">
	              <h2 className="font-display text-lg font-semibold text-slate-100">Linked to implementation</h2>
	              <p className="mt-3 text-sm leading-7 text-slate-300">
	                If a comparison is useful, it should get you into the docs quickly rather than trapping you in more comparison content.
	              </p>
	            </div>
	            <div className="border border-slate-700 bg-slate-900/60 p-6">
	              <h2 className="font-display text-lg font-semibold text-slate-100">Opinionated about fit</h2>
	              <p className="mt-3 text-sm leading-7 text-slate-300">
	                The goal is to clarify where hypequery fits and where the other tool should remain the right choice.
	              </p>
	            </div>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            {comparePages.map((page) => (
              <Link
                key={page.slug}
                href={page.href}
                className="group border border-slate-700 bg-slate-900/70 p-8 transition hover:-translate-y-1 hover:border-indigo-400 hover:bg-slate-900"
              >
                <h2 className="font-display text-2xl font-semibold text-slate-100">{page.title}</h2>
                <p className="mt-4 text-sm leading-7 text-slate-300">{page.verdict}</p>
                <div className="mt-6 flex flex-wrap gap-2">
                  {page.rows.map((row) => (
                    <span
                      key={`${page.slug}-${row.label}`}
                      className="border border-slate-700 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-300"
                    >
                      {row.label}
                    </span>
                  ))}
                </div>
                <p className="mt-6 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300 group-hover:text-cyan-200">
                  Open comparison
                </p>
              </Link>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-20 lg:px-6">
          <div className="border border-indigo-500/35 bg-slate-950 p-8 md:flex md:items-center md:justify-between md:gap-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-indigo-300">Next step</p>
	              <h2 className="font-display mt-3 text-2xl font-semibold text-white">
	                Start with the quick start once you know the shape you want
	              </h2>
	              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">
	                Do not linger in comparison mode longer than necessary. Once one path looks right, test it against your own schema and one real query.
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
                href="/clickhouse-query-builder"
                className="inline-flex items-center border border-slate-600 px-5 py-3 text-sm font-semibold text-slate-100 transition hover:bg-slate-800"
              >
                See the query builder
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
