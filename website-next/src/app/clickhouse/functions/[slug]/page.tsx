import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import Navigation from '@/components/Navigation';
import Footer from '@/components/Footer';
import CodeWindow from '@/components/CodeWindow';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { absoluteUrl, ogImage } from '@/lib/site';
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
      images: ogImage(fn.metaTitle),
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
  array: 'Array Functions',
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
        ...(fn.updated && { dateModified: fn.updated }),
        ...(fn.docsUrl && { citation: fn.docsUrl }),
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
      <main className="min-h-screen bg-bg pt-28 text-text">
        {/* Hero */}
        <section className="relative overflow-hidden border-b border-border">
          <div className="relative mx-auto max-w-7xl px-4 py-20 lg:px-6">
            <Breadcrumbs
              items={[
                { label: 'ClickHouse', href: '/clickhouse' },
                { label: 'Functions', href: '/clickhouse/functions' },
                { label: fn.name },
              ]}
              currentPath={`/clickhouse/functions/${functionPathSegment(fn.name)}`}
            />
            <p className="mt-6 text-xs font-semibold uppercase tracking-[0.3em] text-accent">
              {clusterLabel[fn.cluster] ?? fn.cluster}
            </p>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-text sm:text-5xl">
              <code className="font-mono">{fn.name}</code>
            </h1>
            <p className="mt-4 max-w-3xl text-lg leading-8 text-text-muted">{fn.tagline}</p>

            <div className="mt-8 flex flex-wrap gap-4">
              {/* Signature */}
              <div className="rounded-lg border border-border bg-bg-card px-5 py-3 shadow-card">
                <p className="text-xs uppercase tracking-[0.2em] text-text-dim">Signature</p>
                <code className="mt-1 block font-mono text-sm text-accent">{fn.signature}</code>
              </div>

              {/* Return type */}
              <div className="rounded-lg border border-border bg-bg-card px-5 py-3 shadow-card">
                <p className="text-xs uppercase tracking-[0.2em] text-text-dim">Returns</p>
                <p className="mt-1 font-mono text-sm text-text">{fn.returnType}</p>
              </div>

              {fn.tsType && (
                <div className="rounded-lg border border-border bg-bg-card px-5 py-3 shadow-card">
                  <p className="text-xs uppercase tracking-[0.2em] text-text-dim">In TypeScript</p>
                  <p className="mt-1 font-mono text-sm text-text">{fn.tsType}</p>
                </div>
              )}
            </div>

            {(fn.updated || fn.docsUrl) && (
              <p className="mt-6 text-sm text-text-dim">
                {fn.updated && (
                  <>
                    Updated{' '}
                    <time dateTime={fn.updated}>
                      {new Date(fn.updated).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        timeZone: 'UTC',
                      })}
                    </time>
                  </>
                )}
                {fn.updated && fn.docsUrl && ' · '}
                {fn.docsUrl && (
                  <>
                    Official reference:{' '}
                    <a href={fn.docsUrl} className="text-accent underline-offset-4 hover:underline" rel="noopener">
                      {fn.name} in the ClickHouse docs
                    </a>
                  </>
                )}
              </p>
            )}
          </div>
        </section>

        {/* Description */}
        <section className="mx-auto max-w-7xl px-4 py-14 lg:px-6">
          <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-accent">What it does</p>
              <h2 className="mt-3 text-2xl font-semibold text-text">
                {fn.description}
              </h2>
              <p className="mt-5 text-base leading-8 text-text-muted">{fn.longDescription}</p>

              {fn.notes.length > 0 && (
                <div className="mt-8">
                  <p className="text-xs font-semibold uppercase tracking-[0.25em] text-text-dim">Notes</p>
                  <ul className="mt-4 space-y-3 text-sm text-text-muted">
                    {fn.notes.map((note) => (
                      <li key={note} className="flex gap-3">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                        <span>{note}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* SQL Example */}
            <div className="rounded-lg border border-border bg-bg-card p-6 shadow-card">
              <p className="text-xs uppercase tracking-[0.25em] text-text-dim">Example SQL</p>
              <h3 className="mt-3 text-xl font-semibold text-text">
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

        {/* Common questions: placed high because these answers are what searchers and AI answers look for */}
        {fn.faqItems.length > 0 && (
          <section>
            <div className="mx-auto max-w-7xl px-4 pb-14 lg:px-6">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-text-dim">Common questions</p>
              <h2 className="mt-3 text-2xl font-semibold text-text">
                {fn.name} questions, answered
              </h2>
              <div className="mt-8 space-y-6">
                {fn.faqItems.map((item) => (
                  <div key={item.question} className="rounded-lg border border-border bg-bg-card p-6 shadow-card">
                    <h3 className="text-lg font-semibold text-text">{item.question}</h3>
                    <p className="mt-3 text-sm leading-7 text-text-muted">{item.answer}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* TypeScript / hypequery example */}
        <section className="border-y border-border bg-bg-alt/60">
          <div className="mx-auto max-w-7xl px-4 py-14 lg:px-6">
            <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr]">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-accent">
                  TypeScript with hypequery
                </p>
                <h2 className="mt-3 text-2xl font-semibold text-text">
                  Use {fn.name} in a typed TypeScript query
                </h2>
                <p className="mt-5 text-base leading-8 text-text-muted">
                  hypequery gives you a type-safe query builder for ClickHouse. The generated schema maps your
                  ClickHouse columns to TypeScript types, and raw SQL expressions let you incorporate functions like
                  {` ${fn.name} `} when you need them inside a builder query.
                </p>
                <div className="mt-8 flex flex-wrap gap-4">
                  <Link
                    href="/docs/quick-start"
                    data-umami-event="cta_click"
                    data-umami-event-target="docs_quick_start"
                    data-umami-event-location="example_panel"
                    className="bg-text px-5 py-3 text-sm font-semibold text-bg transition hover:opacity-90"
                  >
                    Quick start
                  </Link>
                  <Link
                    href="/clickhouse-typescript"
                    className="border border-border-strong px-5 py-3 text-sm font-semibold text-text transition hover:bg-bg-alt"
                  >
                    ClickHouse TypeScript guide
                  </Link>
                </div>
              </div>
              <div className="rounded-lg border border-border bg-bg-card p-6 shadow-card">
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
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-text-dim">Use cases</p>
          <h2 className="mt-3 text-2xl font-semibold text-text">
            What teams use {fn.name} for
          </h2>
          <div className="mt-8 grid gap-6 md:grid-cols-2">
            {fn.searchIntentCards.map((card) => (
              <div key={card.title} className="rounded-lg border border-border bg-bg-card p-6 shadow-card">
                <h3 className="text-lg font-semibold text-text">{card.title}</h3>
                <p className="mt-3 text-sm leading-7 text-text-muted">{card.copy}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Related functions + pillars */}
        <section className="mx-auto max-w-7xl px-4 py-14 lg:px-6">
          <div className="grid gap-8 lg:grid-cols-[0.6fr_0.4fr]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-accent">Related functions</p>
              <h2 className="mt-3 text-2xl font-semibold text-text">
                Functions used alongside {fn.name}
              </h2>
              {resolvedRelatedFunctions.length > 0 ? (
                <div className="mt-6 flex flex-wrap gap-3">
                  {resolvedRelatedFunctions.map((related) => (
                    <Link
                      key={related.slug}
                      href={`/clickhouse/functions/${functionPathSegment(related.name)}`}
                      className="rounded-md border border-border bg-bg-card px-4 py-2 font-mono text-sm text-accent transition hover:border-border-strong hover:bg-bg-alt"
                    >
                      {related.name}()
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="mt-6 text-sm leading-7 text-text-dim">
                  More function pages are being added. Use the full function index for the currently published reference set.
                </p>
              )}
            </div>
            <div className="rounded-lg border border-border bg-bg-card p-6 shadow-card">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-text-dim">Related guides</p>
              <div className="mt-5 space-y-3">
                {fn.relatedPillars.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="block rounded-md border border-border px-4 py-3 text-sm font-medium text-text transition hover:border-border-strong hover:bg-bg-alt"
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
          <div className="rounded-lg border border-border-strong bg-bg-card p-8 shadow-card md:flex md:items-center md:justify-between md:gap-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-accent">Next step</p>
              <h2 className="mt-3 text-2xl font-semibold text-text">
                Use {fn.name} in a type-safe TypeScript query
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-text-muted">
                hypequery generates TypeScript types from your ClickHouse schema. Use {fn.name} alongside the builder,
                and reach for raw SQL expressions when the function is not exposed as a dedicated helper.
              </p>
            </div>
            <div className="mt-6 flex gap-3 md:mt-0">
              <Link
                href="/docs/quick-start"
                data-umami-event="cta_click"
                data-umami-event-target="docs_quick_start"
                data-umami-event-location="next_step_primary"
                className="inline-flex items-center bg-text px-5 py-3 text-sm font-semibold text-bg transition hover:opacity-90"
              >
                Quick start
              </Link>
              <Link
                href="/clickhouse/functions"
                className="inline-flex items-center border border-border-strong px-5 py-3 text-sm font-semibold text-text transition hover:bg-bg-alt"
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
