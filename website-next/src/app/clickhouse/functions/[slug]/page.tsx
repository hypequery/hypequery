import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import Navigation from '@/components/Navigation';
import Footer from '@/components/Footer';
import CodeWindow from '@/components/CodeWindow';
import { absoluteUrl } from '@/lib/site';
import {
  clickhouseFunctions,
  findFunction,
  functionPathSegment,
} from '@/data/clickhouse-functions';

type Props = {
  params: Promise<{ slug: string }>;
};

export async function generateStaticParams() {
  return clickhouseFunctions.map((fn) => ({ slug: functionPathSegment(fn.name) }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const fn = findFunction(slug);
  if (!fn) return {};

  const canonical = absoluteUrl(`/clickhouse/functions/${functionPathSegment(fn.name)}`);

  return {
    title: fn.metaTitle,
    description: fn.metaDescription,
    alternates: { canonical },
    openGraph: {
      type: 'website',
      url: canonical,
      title: fn.metaTitle,
      description: fn.metaDescription,
    },
    twitter: {
      card: 'summary_large_image',
      title: fn.metaTitle,
      description: fn.metaDescription,
    },
  };
}

const clusterLabel: Record<string, string> = {
  date: 'Date Functions',
  aggregate: 'Aggregate Functions',
  string: 'String Functions',
  conditional: 'Conditional Functions',
  math: 'Math Functions',
};

export default function ClickHouseFunctionPage({ params }: Props) {
  return <ClickHouseFunctionPageInner params={params} />;
}

async function ClickHouseFunctionPageInner({ params }: Props) {
  const { slug } = await params;
  const fn = findFunction(slug);
  if (!fn) notFound();

  const resolvedRelatedFunctions = fn.relatedFunctions
    .map((name) => findFunction(name))
    .filter((candidate, index, arr): candidate is NonNullable<typeof candidate> => {
      if (!candidate) return false;
      return arr.findIndex((item) => item?.slug === candidate.slug) === index;
    });

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'TechArticle',
        headline: fn.metaTitle,
        description: fn.metaDescription,
        url: absoluteUrl(`/clickhouse/functions/${functionPathSegment(fn.name)}`).toString(),
        author: { '@type': 'Organization', name: 'hypequery' },
        publisher: {
          '@type': 'Organization',
          name: 'hypequery',
          url: absoluteUrl('/').toString(),
        },
      },
      {
        '@type': 'FAQPage',
        mainEntity: fn.faqItems.map((item) => ({
          '@type': 'Question',
          name: item.question,
          acceptedAnswer: { '@type': 'Answer', text: item.answer },
        })),
      },
    ],
  };

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
            <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.3em] text-indigo-300">
              <Link href="/clickhouse/functions" className="hover:text-indigo-200 transition">
                ClickHouse Functions
              </Link>
              <span className="text-slate-600">/</span>
              <span className="text-cyan-300">{clusterLabel[fn.cluster] ?? fn.cluster}</span>
            </div>
            <h1 className="font-display mt-4 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
              <code className="font-mono">{fn.name}</code>
            </h1>
            <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-300">{fn.tagline}</p>

            {/* Signature */}
            <div className="mt-8 inline-block border border-slate-700 bg-slate-950/80 px-5 py-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Signature</p>
              <code className="mt-1 block font-mono text-sm text-cyan-200">{fn.signature}</code>
            </div>

            {/* Return type */}
            <div className="mt-4 inline-block ml-4 border border-slate-700 bg-slate-950/80 px-5 py-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Returns</p>
              <p className="mt-1 font-mono text-sm text-slate-200">{fn.returnType}</p>
            </div>
          </div>
        </section>

        {/* Description */}
        <section className="mx-auto max-w-7xl px-4 py-14 lg:px-6">
          <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-300">What it does</p>
              <h2 className="font-display mt-3 text-2xl font-semibold text-white">
                {fn.description}
              </h2>
              <p className="mt-5 text-base leading-8 text-slate-300">{fn.longDescription}</p>

              {fn.notes.length > 0 && (
                <div className="mt-8">
                  <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Notes</p>
                  <ul className="mt-4 space-y-3 text-sm text-slate-300">
                    {fn.notes.map((note) => (
                      <li key={note} className="flex gap-3">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300" />
                        <span>{note}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* SQL Example */}
            <div className="border border-slate-700 bg-slate-950/80 p-6">
              <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Example SQL</p>
              <h3 className="font-display mt-3 text-xl font-semibold text-white">
                {fn.name} in ClickHouse SQL
              </h3>
              <CodeWindow
                code={fn.exampleSql}
                filename={`${fn.slug}-example.sql`}
                className="mt-4"
              />
            </div>
          </div>
        </section>

        {/* TypeScript / hypequery example */}
        <section className="border-y border-slate-800 bg-slate-950/60">
          <div className="mx-auto max-w-7xl px-4 py-14 lg:px-6">
            <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr]">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-indigo-300">
                  TypeScript with hypequery
                </p>
                <h2 className="font-display mt-3 text-2xl font-semibold text-white">
                  Use {fn.name} in a typed TypeScript query
                </h2>
                <p className="mt-5 text-base leading-8 text-slate-300">
                  hypequery gives you a type-safe query builder for ClickHouse. The generated schema maps your
                  ClickHouse columns to TypeScript types, and raw SQL expressions let you incorporate functions like
                  {` ${fn.name} `} when you need them inside a builder query.
                </p>
                <div className="mt-8 flex flex-wrap gap-4">
                  <Link
                    href="/docs/quick-start"
                    className="bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500"
                  >
                    Quick start
                  </Link>
                  <Link
                    href="/clickhouse-typescript"
                    className="border border-slate-600 px-5 py-3 text-sm font-semibold text-slate-100 transition hover:bg-white/10"
                  >
                    ClickHouse TypeScript guide
                  </Link>
                </div>
              </div>
              <div className="border border-slate-700 bg-slate-950/80 p-6">
                <CodeWindow
                  code={fn.hypequeryExample}
                  filename={fn.hypequeryFilename}
                  className="mt-0"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Search intent cards */}
        <section className="mx-auto max-w-7xl px-4 py-14 lg:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Common questions</p>
          <h2 className="font-display mt-3 text-2xl font-semibold text-white">
            What developers search for with {fn.name}
          </h2>
          <div className="mt-8 grid gap-6 md:grid-cols-2">
            {fn.searchIntentCards.map((card) => (
              <div key={card.title} className="border border-slate-700 bg-slate-900/70 p-6">
                <h3 className="font-display text-lg font-semibold text-slate-100">{card.title}</h3>
                <p className="mt-3 text-sm leading-7 text-slate-300">{card.copy}</p>
              </div>
            ))}
          </div>
        </section>

        {/* FAQ */}
        {fn.faqItems.length > 0 && (
          <section className="border-y border-slate-800 bg-slate-950/60">
            <div className="mx-auto max-w-7xl px-4 py-14 lg:px-6">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">FAQ</p>
              <h2 className="font-display mt-3 text-2xl font-semibold text-white">
                Frequently asked questions about {fn.name}
              </h2>
              <div className="mt-8 space-y-6">
                {fn.faqItems.map((item) => (
                  <div key={item.question} className="border border-slate-700 bg-slate-900/60 p-6">
                    <h3 className="font-display text-lg font-semibold text-slate-100">{item.question}</h3>
                    <p className="mt-3 text-sm leading-7 text-slate-300">{item.answer}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Related functions + pillars */}
        <section className="mx-auto max-w-7xl px-4 py-14 lg:px-6">
          <div className="grid gap-8 lg:grid-cols-[0.6fr_0.4fr]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-indigo-300">Related functions</p>
              <h2 className="font-display mt-3 text-2xl font-semibold text-white">
                Functions used alongside {fn.name}
              </h2>
              {resolvedRelatedFunctions.length > 0 ? (
                <div className="mt-6 flex flex-wrap gap-3">
                  {resolvedRelatedFunctions.map((related) => (
                    <Link
                      key={related.slug}
                      href={`/clickhouse/functions/${functionPathSegment(related.name)}`}
                      className="border border-slate-700 bg-slate-900/70 px-4 py-2 font-mono text-sm text-cyan-300 transition hover:border-cyan-400 hover:bg-slate-900"
                    >
                      {related.name}()
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="mt-6 text-sm leading-7 text-slate-400">
                  More function pages are being added. Use the full function index for the currently published reference set.
                </p>
              )}
            </div>
            <div className="border border-slate-700 bg-slate-950/80 p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Related guides</p>
              <div className="mt-5 space-y-3">
                {fn.relatedPillars.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="block border border-slate-800 px-4 py-3 text-sm font-medium text-slate-200 transition hover:border-cyan-400 hover:bg-slate-900"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto max-w-7xl px-4 pb-20 lg:px-6">
          <div className="border border-indigo-500/35 bg-slate-950 p-8 md:flex md:items-center md:justify-between md:gap-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-indigo-300">Next step</p>
              <h2 className="font-display mt-3 text-2xl font-semibold text-white">
                Use {fn.name} in a type-safe TypeScript query
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">
                hypequery generates TypeScript types from your ClickHouse schema. Use {fn.name} alongside the builder,
                and reach for raw SQL expressions when the function is not exposed as a dedicated helper.
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
                href="/clickhouse/functions"
                className="inline-flex items-center border border-slate-600 px-5 py-3 text-sm font-semibold text-slate-100 transition hover:bg-slate-800"
              >
                All functions
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
