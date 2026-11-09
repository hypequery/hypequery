import { Fragment } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { marketing } from '@/components/ui/marketing';
import { notFound } from 'next/navigation';
import PageWrapper from '@/components/PageWrapper';
import MarkdownContent from '@/components/MarkdownContent';
import RelatedContent from '@/components/RelatedContent';
import { chooseAlternativeHeading, getCompareArticle } from '@/lib/compare-article';
import { compareLinksFor } from '@/lib/compare-links';
import { faqPageSchema } from '@/lib/faq-schema';
import { formatLongDate } from '@/lib/format-date';
import { absoluteUrl, ogImage } from '@/lib/site';
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

  const article = await getCompareArticle(slug);
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
      modifiedTime: article?.updated && article.updated.slice(0, 10) > (article.date ?? '').slice(0, 10) ? article.updated : article?.date,
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

  const article = await getCompareArticle(slug);

  if (!article) {
    notFound();
  }

  const publishDate = article.date;
  // Only a later day than publication counts as an update.
  const updatedDate =
    article.updated && (!article.date || article.updated.slice(0, 10) > article.date.slice(0, 10)) ? article.updated : undefined;
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
    dateModified: updatedDate ?? publishDate ?? undefined,
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
  const faqSchema = faqPageSchema(comparePage.faq);
  const links = compareLinksFor(comparePage.slug);
  const alternativeHeading = chooseAlternativeHeading(comparePage);

  return (
    <PageWrapper>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />
        <section className="border-b border-border">
          <div className={`${marketing.container} pb-14 pt-12 sm:pb-16 sm:pt-16`}>
            <p className="font-mono text-xs text-accent">Compare</p>
            <h1 className={`mt-5 max-w-[980px] ${marketing.heroTitle}`}>
              {article.title}
            </h1>
            <p className={`mt-5 max-w-[700px] ${marketing.heroLead}`}>
              {article.description ?? comparePage.verdict}
            </p>
            {updatedDate ? (
              <p className="mt-4 font-mono text-xs text-text-dim">
                Updated <time dateTime={updatedDate}>{formatLongDate(updatedDate)}</time>
              </p>
            ) : null}
	            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                href={links.primary.href}
                data-umami-event="cta_click"
                data-umami-event-target={links.primary.target}
                data-umami-event-location="hero_primary"
                className={marketing.primaryButton}
              >
                {links.primary.label}
              </Link>
              <Link
                href={links.secondary.href}
                className={marketing.secondaryButton}
              >
                {links.secondary.label}
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
              {comparePage.rows.slice(0, 3).map((row) => (
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

        <section className={`${marketing.container} pb-14 sm:pb-20`}>
          <div className="rounded-xl border border-border-strong bg-bg-card p-6 shadow-card sm:p-8">
            <h2 className={marketing.sectionTitle}>{alternativeHeading}</h2>
            <ul className="mt-6 space-y-3">
              {comparePage.chooseAlternativeWhen.map((item) => (
                <li key={item} className="flex gap-3 text-sm leading-6 text-text-muted">
                  <span aria-hidden="true" className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
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
                <p className="text-sm text-text-dim">
                  Published <time dateTime={publishDate}>{formatLongDate(publishDate)}</time>
                  {updatedDate ? (
                    <>
                      {' · '}Updated <time dateTime={updatedDate}>{formatLongDate(updatedDate)}</time>
                    </>
                  ) : null}
                </p>
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
                  href={links.primary.href}
                  data-umami-event="cta_click"
                  data-umami-event-target={links.primary.target}
                  data-umami-event-location="article_body"
                  className={marketing.primaryButton}
                >
                  {links.primary.label}
                </Link>
                <Link
                  href={links.body.href}
                  className={marketing.secondaryButton}
                >
                  {links.body.label}
                </Link>
              </div>
            </div>
            <RelatedContent
              eyebrow="Related content"
              title="Continue into implementation"
              links={links.related}
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
                {links.nextStep.title}
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-text-muted">
                {links.nextStep.description}
              </p>
            </div>
            <div className="mt-6 flex shrink-0 flex-wrap gap-3 md:mt-0">
              <Link
                href={links.primary.href}
                data-umami-event="cta_click"
                data-umami-event-target={links.primary.target}
                data-umami-event-location="next_step_primary"
                className={marketing.primaryButton}
              >
                {links.primary.label}
              </Link>
              <Link
                href={links.body.href}
                className={marketing.secondaryButton}
              >
                {links.body.label}
              </Link>
            </div>
          </div>
        </section>
    </PageWrapper>
  );
}
