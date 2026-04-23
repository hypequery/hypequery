import { Fragment } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import Navigation from '@/components/Navigation';
import Footer from '@/components/Footer';
import CodeHighlight from '@/components/CodeHighlight';
import RelatedContent from '@/components/RelatedContent';
import { getPostBySlug } from '@/lib/blog';
import { absoluteUrl } from '@/lib/site';
import { comparePageBySlug, comparePages } from '@/data/compare-pages';

export async function generateStaticParams() {
  return comparePages.map((page) => ({ slug: page.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const comparePage = comparePageBySlug[slug as keyof typeof comparePageBySlug];

  if (!comparePage) {
    return {};
  }

  const post = await getPostBySlug(slug);
  const title = post?.data.seoTitle ?? post?.data.title ?? comparePage.title;
  const description = post?.data.seoDescription ?? post?.data.description ?? comparePage.verdict;
  const url = absoluteUrl(comparePage.href);

  return {
    title,
    description,
    alternates: {
      canonical: url,
    },
    openGraph: {
      type: 'article',
      url,
      title,
      description,
      publishedTime: post?.data.date,
      tags: post?.data.tags,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}

export default async function ComparePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const comparePage = comparePageBySlug[slug as keyof typeof comparePageBySlug];

  if (!comparePage) {
    notFound();
  }

  const post = await getPostBySlug(slug);

  if (!post) {
    notFound();
  }

  const publishDate = post.data.date;
  const pageUrl = absoluteUrl(comparePage.href).toString();
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
      {
        '@type': 'ListItem',
        position: 2,
        name: post.data.title,
        item: pageUrl,
      },
    ],
  };
  const articleSchema = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.data.title,
    description: post.data.description ?? comparePage.verdict,
    datePublished: publishDate ?? undefined,
    dateModified: publishDate ?? undefined,
    mainEntityOfPage: pageUrl,
    author: {
      '@type': 'Organization',
      name: 'hypequery',
    },
    publisher: {
      '@type': 'Organization',
      name: 'hypequery',
      url: absoluteUrl('/').toString(),
    },
  };
  const relatedLinks = [
    {
      href: '/docs/quick-start',
      title: 'Quick start',
      description: 'Move from evaluation to implementation with generated schema types and your first typed query.',
    },
    {
      href: '/clickhouse-typescript',
      title: 'ClickHouse TypeScript',
      description: 'The broader workflow for reusable queries, HTTP APIs, and runtime type safety.',
    },
    {
      href: '/compare',
      title: 'Compare more options',
      description: 'Return to the comparison hub if you want to evaluate the other path next.',
    },
  ];

  return (
    <>
      <Navigation />
      <main className="min-h-screen bg-[#020617] pt-28 text-gray-100">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }} />
        <section className="border-b border-slate-800/80">
          <div className="mx-auto max-w-7xl px-4 py-20 lg:px-6">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-indigo-300">Compare</p>
            <h1 className="font-display mt-4 max-w-5xl text-4xl font-semibold tracking-tight text-white sm:text-6xl">
              {post.data.title}
            </h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-300">
              {post.data.description ?? comparePage.verdict}
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link
                href="/docs/quick-start"
                className="bg-indigo-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500"
              >
                Start with the quick start
              </Link>
              <Link
                href="/clickhouse-query-builder"
                className="border border-slate-600 px-6 py-3 text-sm font-semibold text-slate-100 transition hover:bg-white/10"
              >
                See the query builder
              </Link>
              <Link
                href="/compare"
                className="border border-slate-600 px-6 py-3 text-sm font-semibold text-slate-100 transition hover:bg-white/10"
              >
                Compare more options
              </Link>
            </div>
            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              <div className="border border-slate-700/80 bg-slate-950/70 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Decision type</p>
                <p className="mt-2 text-sm leading-7 text-slate-100">Architecture and workflow fit</p>
              </div>
              <div className="border border-slate-700/80 bg-slate-950/70 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Audience</p>
                <p className="mt-2 text-sm leading-7 text-slate-100">TypeScript teams building on ClickHouse</p>
              </div>
              <div className="border border-slate-700/80 bg-slate-950/70 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Outcome</p>
                <p className="mt-2 text-sm leading-7 text-slate-100">Choose a path and move into implementation</p>
              </div>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              {comparePage.rows.map((row) => (
                <div key={row.label} className="border border-slate-700/80 bg-slate-950/70 p-5">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{row.label}</p>
                  <p className="mt-2 text-sm leading-7 text-slate-100">{row.hypequery}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-16 lg:px-6">
          <div className="mb-10 grid gap-6 md:grid-cols-3">
            <div className="border border-slate-700 bg-slate-900/60 p-6">
              <h2 className="font-display text-lg font-semibold text-slate-100">What this page is for</h2>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                Use this page when the question is not just syntax, but how a tool fits a ClickHouse-heavy application architecture.
              </p>
            </div>
            <div className="border border-slate-700 bg-slate-900/60 p-6">
              <h2 className="font-display text-lg font-semibold text-slate-100">What this page is not</h2>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                It is not a generic ecosystem roundup. The comparison is intentionally focused on teams building reusable analytics behavior in TypeScript.
              </p>
            </div>
            <div className="border border-slate-700 bg-slate-900/60 p-6">
              <h2 className="font-display text-lg font-semibold text-slate-100">Recommended next move</h2>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                If hypequery looks like the right fit, move directly into the quick start and the ClickHouse TypeScript guide.
              </p>
            </div>
          </div>
          <div className="grid gap-8 lg:grid-cols-[0.7fr_1.3fr_1.3fr]">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Dimension</div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-300">hypequery</div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Alternative</div>
            {comparePage.rows.map((row) => (
              <Fragment key={row.label}>
                <div className="border-t border-slate-800 pt-4 text-sm font-semibold text-white">
                  {row.label}
                </div>
                <div className="border-t border-slate-800 pt-4 text-sm leading-7 text-slate-300">
                  {row.hypequery}
                </div>
                <div className="border-t border-slate-800 pt-4 text-sm leading-7 text-slate-300">
                  {row.alternative}
                </div>
              </Fragment>
            ))}
          </div>
        </section>

        <section className="border-y border-slate-800 bg-slate-950/60">
          <div className="mx-auto max-w-4xl px-4 py-16 lg:px-6">
            <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
              <Link
                href="/compare"
                className="text-sm text-slate-400 transition hover:text-white"
              >
                Back to comparisons
              </Link>
              {publishDate ? (
                <time className="text-sm text-slate-500" dateTime={publishDate}>
                  {new Date(publishDate).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </time>
              ) : null}
            </div>

            <div className="prose prose-invert max-w-none">
              <ReactMarkdown
                components={{
                  code({ className, children, ...props }) {
                    const match = /language-(\w+)/.exec(className || '');
                    const code = String(children).replace(/\n$/, '');

                    if (!match) {
                      return (
                        <code className={className} {...props}>
                          {children}
                        </code>
                      );
                    }

                    return <CodeHighlight code={code} language={match[1]} />;
                  },
                }}
              >
                {post.content}
              </ReactMarkdown>
            </div>
            <div className="mt-10 border border-slate-700 bg-slate-900/70 p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-300">Decision checkpoint</p>
              <h2 className="font-display mt-3 text-2xl font-semibold text-white">
                If the tradeoff is already clear, move into implementation
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">
                Teams usually do not need more comparison content after this point. The faster path is to generate schema types and build one real query against your own ClickHouse schema.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  href="/docs/quick-start"
                  className="inline-flex items-center bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500"
                >
                  Open quick start
                </Link>
                <Link
                  href="/clickhouse-typescript"
                  className="inline-flex items-center border border-slate-600 px-5 py-3 text-sm font-semibold text-slate-100 transition hover:bg-slate-800"
                >
                  ClickHouse TypeScript
                </Link>
              </div>
            </div>
            <RelatedContent
              eyebrow="Related content"
              title="Continue into implementation"
              links={relatedLinks}
            />
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-16 lg:px-6">
          <h2 className="font-display text-3xl font-semibold text-white">FAQ</h2>
          <div className="mt-8 grid gap-6 md:grid-cols-2">
            {comparePage.faq.map((item) => (
              <div key={item.question} className="border border-slate-700 bg-slate-900/70 p-6">
                <h3 className="font-display text-xl font-semibold text-slate-100">{item.question}</h3>
                <p className="mt-3 text-sm leading-7 text-slate-300">{item.answer}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-20 lg:px-6">
          <div className="border border-indigo-500/35 bg-slate-950 p-8 md:flex md:items-center md:justify-between md:gap-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-indigo-300">Next step</p>
              <h2 className="font-display mt-3 text-2xl font-semibold text-white">
                Move from evaluation into a typed ClickHouse workflow
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">
                Generate schema types, define your first reusable query, and decide whether it should run locally or
                over HTTP.
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
                href="/clickhouse-typescript"
                className="inline-flex items-center border border-slate-600 px-5 py-3 text-sm font-semibold text-slate-100 transition hover:bg-slate-800"
              >
                ClickHouse TypeScript
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
