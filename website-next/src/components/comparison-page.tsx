import Link from 'next/link';
import type { Metadata } from 'next';
import { Fragment, type ReactNode } from 'react';
import CodeWindow from '@/components/CodeWindow';
import { HubFaq, HubSection, HubShell, HubSources, HubTable } from '@/components/hub-page';
import { DeployWaitlist } from '@/components/home/DeployWaitlist';
import { RelatedPages } from '@/components/related-pages';
import { marketing } from '@/components/ui/marketing';
import { softwareApplicationSchema } from '@/data/product';
import { compareRelatedLinks } from '@/data/related-pages';
import { COMPARISON_ROWS, type ComparisonPage } from '@/data/comparisons/types';
import { formatLongDate } from '@/lib/format-date';
import { absoluteUrl, ogImage } from '@/lib/site';
import { faqJsonLd, techArticleJsonLd } from '@/lib/structured-data';

const inlineLink =
  'font-medium text-text underline decoration-border-strong underline-offset-4 transition hover:text-accent hover:decoration-accent';
const inlineCode = 'font-mono text-[0.92em] text-text';

/** Renders `code` spans and [text](href) links in a copy string. Internal links use next/link. */
export function Prose({ text }: { text: string }): ReactNode {
  const pattern = /`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    if (match[1] !== undefined) {
      nodes.push(
        <code key={match.index} className={inlineCode}>
          {match[1]}
        </code>,
      );
    } else {
      const href = match[3];
      nodes.push(
        href.startsWith('/') || href.startsWith('#') ? (
          <Link key={match.index} href={href} className={inlineLink}>
            {match[2]}
          </Link>
        ) : (
          <a key={match.index} href={href} rel="noopener nofollow" className={inlineLink}>
            {match[2]}
          </a>
        ),
      );
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return <>{nodes.map((node, index) => <Fragment key={index}>{node}</Fragment>)}</>;
}

export function comparisonMetadata(page: ComparisonPage): Metadata {
  return {
    title: { absolute: page.title },
    description: page.description,
    alternates: { canonical: absoluteUrl(page.path) },
    openGraph: {
      type: 'article',
      url: absoluteUrl(page.path),
      title: page.title,
      description: page.description,
      images: ogImage(page.h1),
    },
    twitter: { card: 'summary_large_image', title: page.title, description: page.description },
  };
}

/** Groups the page's sources by host for the visible Sources list. */
function sourcesByVendor(page: ComparisonPage) {
  const urls = Array.from(new Set(page.sources.map((source) => source.url)));
  return [{ vendor: page.competitor, urls }];
}

/**
 * A hypequery-vs-<vendor> page. Sections, in order: TL;DR, comparison table,
 * when the other product is the better choice, when to choose hypequery, the
 * page's longer sections, code, FAQ, next step, related pages, sources.
 */
export function ComparisonPageView({ page, updated }: { page: ComparisonPage; updated: string }) {
  const verifiedOn = formatLongDate(page.verifiedOn);
  const rows = COMPARISON_ROWS.map(([key, label]) => [label, page.rows[key].hypequery, page.rows[key].competitor]);

  return (
    <HubShell
      path={page.path}
      breadcrumbs={[
        { label: 'Home', href: '/' },
        { label: 'Compare', href: '/compare' },
        { label: page.h1 },
      ]}
      eyebrow="Compare"
      title={page.h1}
      updated={updated}
      lead={
        <div className="space-y-3">
          <p className="font-mono text-xs text-text-dim">TL;DR</p>
          <p>{page.tldr.join(' ')}</p>
        </div>
      }
      primaryCta={{ href: '#comparison', label: 'Side by side', target: `${page.slug}_table` }}
      secondaryCta={{ href: '/docs/quick-start', label: 'Quick start', target: 'docs_quick_start' }}
      jsonLd={[
        techArticleJsonLd({
          path: page.path,
          headline: page.title,
          description: page.description,
          datePublished: page.published,
          dateModified: updated,
        }),
        { '@context': 'https://schema.org', ...softwareApplicationSchema },
        faqJsonLd(page.faq),
      ]}
    >
      {page.notice ? (
        <section className={`${marketing.container} pt-10`}>
          <div className="max-w-[860px] rounded-xl border border-accent/50 bg-bg-card p-6 shadow-card">
            <p className="font-mono text-xs text-accent">Status</p>
            <h2 className="mt-2 text-xl font-medium tracking-tight text-text">{page.notice.title}</h2>
            <p className="mt-3 text-[15px] leading-7 text-text-muted">
              <Prose text={page.notice.body} />
            </p>
          </div>
        </section>
      ) : null}

      <HubSection
        id="comparison"
        eyebrow="At a glance"
        title={`hypequery and ${page.competitor} side by side`}
        intro={
          <p>
            Ten things to check before you pick an embedded analytics stack. The {page.competitor} column was checked
            against {page.competitor}&rsquo;s own site and docs on {verifiedOn}; hypequery is our product, and its column
            is checked against this repository&rsquo;s code and docs.
          </p>
        }
      >
        <HubTable
          caption={`hypequery and ${page.competitor} compared, verified ${verifiedOn}`}
          columns={['', 'hypequery', page.competitor]}
          rows={rows}
        />
      </HubSection>

      <HubSection band eyebrow="Best fit" title={`When ${page.competitor} is the better choice`}>
        <ul className="max-w-[760px] list-disc space-y-3 pl-5 text-body text-text-muted">
          {page.competitorBetterWhen.map((item) => (
            <li key={item}>
              <Prose text={item} />
            </li>
          ))}
        </ul>
      </HubSection>

      <HubSection eyebrow="Best fit" title="When to choose hypequery">
        <ul className="max-w-[760px] list-disc space-y-3 pl-5 text-body text-text-muted">
          {page.chooseHypequeryWhen.map((item) => (
            <li key={item}>
              <Prose text={item} />
            </li>
          ))}
        </ul>
      </HubSection>

      {page.sections.map((section, index) => (
        <HubSection
          key={section.id}
          id={section.id}
          band={index % 2 === 0}
          eyebrow={section.eyebrow}
          title={section.title}
          intro={
            <>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph}>
                  <Prose text={paragraph} />
                </p>
              ))}
            </>
          }
        />
      ))}

      <HubSection
        id="code"
        band={page.sections.length % 2 === 0}
        eyebrow="Code"
        title="A tenant-scoped dataset, served as an API"
        intro={
          <p>
            The same dataset also serves typed React hooks and MCP tools for agents. See the{' '}
            <Link href="/docs/datasets/multi-tenancy" className={inlineLink}>
              multi-tenancy docs
            </Link>{' '}
            and{' '}
            <Link href="/docs/datasets/tool-generation" className={inlineLink}>
              tool generation
            </Link>
            .
          </p>
        }
      >
        <div className={`grid gap-6 ${page.code.competitor ? 'lg:grid-cols-2' : ''} lg:items-start`}>
          <div className={page.code.competitor ? undefined : 'max-w-[860px]'}>
            <CodeWindow
              code={page.code.hypequery.code}
              filename={page.code.hypequery.filename}
              language={page.code.hypequery.language}
            />
            <p className="mt-3 text-xs leading-5 text-text-dim">
              <Prose text={page.code.hypequery.caption} />
            </p>
          </div>
          {page.code.competitor ? (
            <div>
              <CodeWindow
                code={page.code.competitor.code}
                filename={page.code.competitor.filename}
                language={page.code.competitor.language}
              />
              <p className="mt-3 text-xs leading-5 text-text-dim">
                <Prose text={page.code.competitor.caption} />
              </p>
            </div>
          ) : null}
        </div>
      </HubSection>

      <HubSection eyebrow="Questions" title={`hypequery vs ${page.competitor} FAQ`}>
        <HubFaq items={page.faq} />
      </HubSection>

      <section className={`${marketing.container} pb-14`}>
        <div className="rounded-xl border border-border-strong bg-bg-card p-8 shadow-card md:flex md:items-center md:justify-between md:gap-8">
          <div>
            <p className={marketing.eyebrow}>Next step</p>
            <h2 className="mt-3 text-2xl font-normal tracking-[-0.03em] text-text">Try one tenant-scoped dataset</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-text-muted">
              Define a dataset over a ClickHouse table you already have and serve it from your backend. Want it hosted
              instead? hypequery Cloud is in early access:{' '}
              <DeployWaitlist location={`${page.slug}-next-step`} className={inlineLink} />.
            </p>
          </div>
          <div className="mt-6 flex shrink-0 flex-wrap gap-3 md:mt-0">
            <Link
              href="/docs/quick-start"
              data-umami-event="cta_click"
              data-umami-event-target="docs_quick_start"
              data-umami-event-location="compare_next_step_primary"
              className={marketing.primaryButton}
            >
              Get started <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </section>

      <RelatedPages band title="Related comparisons and docs" pages={compareRelatedLinks(page.path)} />

      <HubSources checkedOn={verifiedOn} sources={sourcesByVendor(page)} />
    </HubShell>
  );
}
