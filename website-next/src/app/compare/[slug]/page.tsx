import { Fragment } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { marketing } from '@/components/ui/marketing';
import { notFound } from 'next/navigation';
import PageWrapper from '@/components/PageWrapper';
import MarkdownContent from '@/components/MarkdownContent';
import RelatedContent from '@/components/RelatedContent';
import { getPostBySlug } from '@/lib/blog';
import { absoluteUrl, ogImage } from '@/lib/site';
import { compareArticles } from '@/data/compare-articles';
import { comparePageBySlug, comparePages } from '@/data/compare-pages';

type CompareArticleView = {
  title: string;
  description?: string;
  seoTitle?: string;
  seoDescription?: string;
  date?: string;
  tags?: string[];
  content: string;
};

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

  const promotedArticle = compareArticles[slug];
  const post = promotedArticle ? null : await getPostBySlug(slug);
  const article: CompareArticleView | null = promotedArticle ?? (post ? {
    title: post.data.title,
    description: post.data.description,
    seoTitle: post.data.seoTitle,
    seoDescription: post.data.seoDescription,
    date: post.data.date,
    tags: post.data.tags,
    content: post.content,
  } : null);
  const title = article?.seoTitle ?? article?.title ?? comparePage.title;
  const description = article?.seoDescription ?? article?.description ?? comparePage.verdict;
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
      publishedTime: article?.date,
      tags: article?.tags,
      images: ogImage(title),
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

  const promotedArticle = compareArticles[slug];
  const post = promotedArticle ? null : await getPostBySlug(slug);
  const article: CompareArticleView | null = promotedArticle ?? (post ? {
    title: post.data.title,
    description: post.data.description,
    seoTitle: post.data.seoTitle,
    seoDescription: post.data.seoDescription,
    date: post.data.date,
    tags: post.data.tags,
    content: post.content,
  } : null);

  if (!article) {
    notFound();
  }

  const publishDate = article.date;
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
        name: article.title,
        item: pageUrl,
      },
    ],
  };
  const articleSchema = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description: article.description ?? comparePage.verdict,
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
    <PageWrapper>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }} />
        <section className="border-b border-border">
          <div className={`${marketing.container} pb-14 pt-12 sm:pb-16 sm:pt-16`}>
            <p className="font-mono text-xs text-accent">Compare</p>
            <h1 className={`mt-5 max-w-[980px] ${marketing.heroTitle}`}>
              {article.title}
            </h1>
            <p className={`mt-5 max-w-[700px] ${marketing.heroLead}`}>
              {article.description ?? comparePage.verdict}
            </p>
	            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                href="/docs/quick-start"
                data-umami-event="cta_click"
                data-umami-event-target="docs_quick_start"
                data-umami-event-location="hero_primary"
                className={marketing.primaryButton}
              >
                Start with the quick start
              </Link>
              <Link
                href="/clickhouse-query-builder"
                className={marketing.secondaryButton}
              >
                See the query builder
              </Link>
              <Link
                href="/compare"
                className={marketing.secondaryButton}
              >
                Compare more options
              </Link>
            </div>
            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-border bg-bg-card shadow-card p-5">
                <p className="font-mono text-xs text-text-dim">Decision type</p>
                <p className="mt-2 text-sm leading-6 text-text">Architecture and workflow fit</p>
              </div>
              <div className="rounded-xl border border-border bg-bg-card shadow-card p-5">
                <p className="font-mono text-xs text-text-dim">Audience</p>
                <p className="mt-2 text-sm leading-6 text-text">TypeScript teams building on ClickHouse</p>
              </div>
              <div className="rounded-xl border border-border bg-bg-card shadow-card p-5">
                <p className="font-mono text-xs text-text-dim">Outcome</p>
                <p className="mt-2 text-sm leading-6 text-text">Choose a path and move into implementation</p>
              </div>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              {comparePage.rows.map((row) => (
                <div key={row.label} className="rounded-xl border border-border bg-bg-card shadow-card p-5">
                  <p className="font-mono text-xs text-text-dim">{row.label}</p>
                  <p className="mt-2 text-sm leading-6 text-text">{row.hypequery}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className={`${marketing.container} py-14 sm:py-20`}>
	            <div className="mb-10 grid gap-6 md:grid-cols-3">
	            <div className="rounded-xl border border-border bg-bg-card shadow-card p-6">
	              <h2 className="text-lg font-medium tracking-tight text-text">What this page is for</h2>
	              <p className="mt-3 text-sm leading-6 text-text-muted">
	                Use this page when the real question is how one tool changes the shape of your ClickHouse application code, not just which syntax looks nicer.
	              </p>
	            </div>
	            <div className="rounded-xl border border-border bg-bg-card shadow-card p-6">
	              <h2 className="text-lg font-medium tracking-tight text-text">What this page is not</h2>
	              <p className="mt-3 text-sm leading-6 text-text-muted">
	                It is not a broad ecosystem roundup. It stays narrow on the tradeoff a ClickHouse-heavy TypeScript team is actually deciding.
	              </p>
	            </div>
	            <div className="rounded-xl border border-border bg-bg-card shadow-card p-6">
	              <h2 className="text-lg font-medium tracking-tight text-text">Recommended next move</h2>
	              <p className="mt-3 text-sm leading-6 text-text-muted">
	                If the tradeoff already looks clear, stop reading comparisons and test the fit against one real query in your own schema.
	              </p>
	            </div>
          </div>
          <div className="grid gap-8 lg:grid-cols-[0.7fr_1.3fr_1.3fr]">
            <div className="font-mono text-xs text-text-dim">Dimension</div>
            <div className="font-mono text-xs text-accent">
              {comparePage.primaryLabel ?? 'hypequery'}
            </div>
            <div className="font-mono text-xs text-text-dim">
              {comparePage.alternativeLabel ?? 'Alternative'}
            </div>
            {comparePage.rows.map((row) => (
              <Fragment key={row.label}>
                <div className="border-t border-border pt-4 text-sm font-medium text-text">
                  {row.label}
                </div>
                <div className="border-t border-border pt-4 text-sm leading-6 text-text-muted">
                  {row.hypequery}
                </div>
                <div className="border-t border-border pt-4 text-sm leading-6 text-text-muted">
                  {row.alternative}
                </div>
              </Fragment>
            ))}
          </div>
        </section>

        <section className={marketing.band}>
          <div className="mx-auto max-w-4xl px-4 py-16 lg:px-6">
            <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
              <Link
                href="/compare"
                className="text-sm text-text-dim transition hover:text-text"
              >
                Back to comparisons
              </Link>
              {publishDate ? (
                <time className="text-sm text-text-dim" dateTime={publishDate}>
                  {new Date(publishDate).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </time>
              ) : null}
            </div>

            <div className="prose prose-invert max-w-none">
              <MarkdownContent content={article.content} />
            </div>
	            <div className="mt-10 rounded-xl border border-border-strong bg-bg-card shadow-card p-6">
	              <p className="font-mono text-xs text-accent">Decision checkpoint</p>
	              <h2 className="mt-3 text-2xl font-normal tracking-[-0.03em] text-text">
	                If the tradeoff is already clear, move into implementation
	              </h2>
	              <p className="mt-3 max-w-2xl text-sm leading-6 text-text-muted">
	                Most teams do not need another round of comparison content after this point. The better test is whether the workflow holds up on your own schema and your own query complexity.
	              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  href="/docs/quick-start"
                  data-umami-event="cta_click"
                  data-umami-event-target="docs_quick_start"
                  data-umami-event-location="article_body"
                  className={marketing.primaryButton}
                >
                  Open quick start
                </Link>
                <Link
                  href="/clickhouse-typescript"
                  className={marketing.secondaryButton}
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

        <section className={`${marketing.container} py-14 sm:py-20`}>
          <h2 className={marketing.sectionTitle}>FAQ</h2>
          <div className="mt-8 grid gap-6 md:grid-cols-2">
            {comparePage.faq.map((item) => (
              <div key={item.question} className="rounded-xl border border-border-strong bg-bg-card shadow-card p-6">
                <h3 className="text-xl font-medium tracking-tight text-text">{item.question}</h3>
                <p className="mt-3 text-sm leading-6 text-text-muted">{item.answer}</p>
              </div>
            ))}
          </div>
        </section>

        <section className={`${marketing.container} pb-20`}>
          <div className="rounded-xl border border-border-strong bg-bg-card p-8 shadow-card md:flex md:items-center md:justify-between md:gap-8">
            <div>
              <p className="font-mono text-xs text-accent">Next step</p>
              <h2 className="mt-3 text-2xl font-normal tracking-[-0.03em] text-text">
                Move from evaluation into a typed ClickHouse workflow
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-text-muted">
                Generate schema types, define your first reusable query, and decide whether it should run locally or
                over HTTP.
              </p>
            </div>
            <div className="mt-6 flex shrink-0 flex-wrap gap-3 md:mt-0">
              <Link
                href="/docs/quick-start"
                data-umami-event="cta_click"
                data-umami-event-target="docs_quick_start"
                data-umami-event-location="next_step_primary"
                className={marketing.primaryButton}
              >
                Open quick start
              </Link>
              <Link
                href="/clickhouse-typescript"
                className={marketing.secondaryButton}
              >
                ClickHouse TypeScript
              </Link>
            </div>
          </div>
        </section>
    </PageWrapper>
  );
}
