import type { Metadata } from 'next';
import Link from 'next/link';
import { marketing } from '@/components/ui/marketing';
import PageWrapper from '@/components/PageWrapper';
import { comparePages } from '@/data/compare-pages';
import { embeddedAnalyticsComparePages } from '@/data/embedded-analytics-compare';
import { compareHubNote } from '@/data/compare-hub';
import { RelatedPages } from '@/components/related-pages';
import { semanticLayerHub } from '@/data/semantic-layer-pages';
import { absoluteUrl, ogImage } from '@/lib/site';

export const metadata: Metadata = {
  title: 'hypequery vs Cube, Tinybird, Drizzle and More',
  description:
    'Compare hypequery with Cube, Metabase, Luzmo, Embeddable, QueryPanel, Tinybird and the ClickHouse clients: who each tool suits and when hypequery fits.',
  alternates: {
    canonical: absoluteUrl('/compare'),
  },
  openGraph: {
    images: ogImage('Compare hypequery'),
    type: 'website',
    url: absoluteUrl('/compare'),
    title: 'hypequery vs Cube, Tinybird, Drizzle and More | hypequery',
    description:
      'Compare hypequery with Cube, Metabase, Luzmo, Embeddable, QueryPanel, Tinybird and the ClickHouse clients: who each tool suits and when hypequery fits.',
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
    <PageWrapper>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />
        <section className="border-b border-border">
          <div className={`${marketing.container} pb-14 pt-12 sm:pb-16 sm:pt-16`}>
            <p className="font-mono text-xs text-accent">Compare</p>
            <h1 className={`mt-5 max-w-[980px] ${marketing.heroTitle}`}>
              Compare hypequery with embedded analytics tools and ClickHouse clients
            </h1>
            <p className={`mt-5 max-w-[700px] ${marketing.heroLead}`}>
              Each card says who the other tool suits and when hypequery is the better pick. The embedded analytics
              comparisons cover hosted platforms such as Luzmo, Embeddable, Metabase and QueryPanel; the developer
              comparisons cover ClickHouse clients, query builders and API platforms. Every page lists where the other
              tool is the better choice.
            </p>
            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-border bg-bg-card shadow-card p-5">
                <p className="font-mono text-xs text-text-dim">Decision focus</p>
                <p className="mt-2 text-xl font-medium tracking-tight text-text">ClickHouse-first TypeScript teams</p>
              </div>
              <div className="rounded-xl border border-border bg-bg-card shadow-card p-5">
                <p className="font-mono text-xs text-text-dim">What you get</p>
                <p className="mt-2 text-xl font-medium tracking-tight text-text">Tradeoffs, not feature checklists</p>
              </div>
              <div className="rounded-xl border border-border bg-bg-card shadow-card p-5">
                <p className="font-mono text-xs text-text-dim">Best next step</p>
                <p className="mt-2 text-xl font-medium tracking-tight text-text">Pick a path, then quick start</p>
              </div>
            </div>
          </div>
        </section>

        <section className={`${marketing.container} pt-14 sm:pt-20`}>
          <p className="font-mono text-xs text-accent">Customer-facing dashboards</p>
          <h2 className={`mt-3 ${marketing.sectionTitle}`}>Embedded analytics</h2>
          <p className="mt-4 max-w-3xl text-sm leading-6 text-text-muted">
            Choosing how to put analytics inside your product: embedded BI platforms, BI tools with embedding, and
            code-first layers you build on. Each page has a dated vendor table and says where hypequery is the wrong fit.
            For the build-or-buy question itself, start with{' '}
            <Link href="/embedded-analytics" className="text-text underline decoration-border-strong underline-offset-4 hover:text-accent">
              embedded analytics for developers
            </Link>
            .
          </p>
          <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {embeddedAnalyticsComparePages.map((page) => (
              <Link
                key={page.href}
                href={page.href}
                className="group rounded-xl border border-border bg-bg-card p-8 transition hover:-translate-y-0.5 hover:border-border-strong hover:shadow-card"
              >
                <h3 className="text-2xl font-normal tracking-[-0.03em] text-text">{page.title}</h3>
                <p className="mt-4 text-sm leading-6 text-text-muted">{page.description}</p>
                <HubNote href={page.href} />
                <p className="mt-6 font-mono text-xs text-accent group-hover:opacity-70">Open comparison</p>
              </Link>
            ))}
            <Link
              href="/clickhouse-saas-analytics"
              className="group rounded-xl border border-border bg-bg-card p-8 transition hover:-translate-y-0.5 hover:border-border-strong hover:shadow-card"
            >
              <h3 className="text-2xl font-normal tracking-[-0.03em] text-text">ClickHouse embedded analytics</h3>
              <p className="mt-4 text-sm leading-6 text-text-muted">
                How hypequery serves in-app dashboards, customer APIs and AI agents from one tenant-scoped model on ClickHouse.
              </p>
              <p className="mt-6 font-mono text-xs text-accent group-hover:opacity-70">Open page</p>
            </Link>
          </div>
        </section>

        <section className={`${marketing.container} py-14 sm:py-20`}>
          <p className="font-mono text-xs text-accent">Developer tools</p>
          <h2 className={`mt-3 mb-8 ${marketing.sectionTitle}`}>ClickHouse clients, query builders and API layers</h2>
          <div className="mb-10 grid gap-6 md:grid-cols-3">
	            <div className="rounded-xl border border-border bg-bg-card shadow-card p-6">
	              <h3 className="text-lg font-medium tracking-tight text-text">Built for real evaluations</h3>
	              <p className="mt-3 text-sm leading-6 text-text-muted">
	                Each page is written around the actual switch a team might make.
	              </p>
	            </div>
	            <div className="rounded-xl border border-border bg-bg-card shadow-card p-6">
	              <h3 className="text-lg font-medium tracking-tight text-text">Linked to implementation</h3>
	              <p className="mt-3 text-sm leading-6 text-text-muted">
	                If a comparison is useful, it should get you into the docs quickly rather than trapping you in more comparison content.
	              </p>
	            </div>
	            <div className="rounded-xl border border-border bg-bg-card shadow-card p-6">
	              <h3 className="text-lg font-medium tracking-tight text-text">Opinionated about fit</h3>
	              <p className="mt-3 text-sm leading-6 text-text-muted">
	                The goal is to clarify where hypequery fits and where the other tool should remain the right choice.
	              </p>
	            </div>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            {comparePages.map((page) => (
              <Link
                key={page.slug}
                href={page.href}
                className="group rounded-xl border border-border bg-bg-card p-8 transition hover:-translate-y-0.5 hover:border-border-strong hover:shadow-card"
              >
                <h3 className="text-2xl font-normal tracking-[-0.03em] text-text">{page.title}</h3>
                <p className="mt-4 text-sm leading-6 text-text-muted">{page.verdict}</p>
                <HubNote href={page.href} />
                <p className="mt-6 font-mono text-xs text-accent group-hover:opacity-70">
                  Open comparison
                </p>
              </Link>
            ))}
          </div>
        </section>

        <section className={`${marketing.container} pb-14 sm:pb-20`}>
          <p className="font-mono text-xs text-accent">Switching tools?</p>
          <h2 className={`mt-3 ${marketing.sectionTitle}`}>Alternative guides</h2>
          <p className="mt-4 max-w-3xl text-sm leading-6 text-text-muted">
            If you are moving away from a platform rather than evaluating from scratch, these guides cover why teams switch, what the migration looks like, and where the incumbent is still the right call.
          </p>
          <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            <Link
              href="/tinybird-alternative"
              className="group rounded-xl border border-border bg-bg-card p-8 transition hover:-translate-y-0.5 hover:border-border-strong hover:shadow-card"
            >
              <h3 className="text-2xl font-normal tracking-[-0.03em] text-text">Tinybird alternatives</h3>
              <p className="mt-4 text-sm leading-6 text-text-muted">
                Keep your data in your own ClickHouse and build the typed API layer in TypeScript or Python, with no ingestion into a third-party platform and no second platform plan to pay for.
              </p>
              <HubNote href="/tinybird-alternative" />
              <p className="mt-6 font-mono text-xs text-accent group-hover:opacity-70">
                Open guide
              </p>
            </Link>
            <Link
              href="/compare/hypequery-vs-moose"
              className="group rounded-xl border border-border bg-bg-card p-8 transition hover:-translate-y-0.5 hover:border-border-strong hover:shadow-card"
            >
              <h3 className="text-2xl font-normal tracking-[-0.03em] text-text">MooseStack alternative</h3>
              <p className="mt-4 text-sm leading-6 text-text-muted">
                MooseStack is end of life. Move its typed ClickHouse query and API layer while separating schema, streaming, and workflow responsibilities.
              </p>
              <HubNote href="/compare/hypequery-vs-moose" />
              <p className="mt-6 font-mono text-xs text-accent group-hover:opacity-70">
                Open guide
              </p>
            </Link>
          </div>
        </section>

        <RelatedPages
          band
          eyebrow="Background"
          title="Start from the concepts"
          pages={[
            {
              href: '/embedded-analytics',
              title: 'Embedded analytics for developers',
              description: 'Embed a BI tool or build with your own components, tenant isolation, and the three kinds of tool.',
            },
            { href: semanticLayerHub.href, title: semanticLayerHub.label, description: semanticLayerHub.description },
            {
              href: '/clickhouse-saas-analytics',
              title: 'ClickHouse embedded analytics',
              description: 'Architectures, tenant isolation, query limits and caching for customer-facing analytics on ClickHouse.',
            },
          ]}
        />

        <section className={`${marketing.container} py-20`}>
          <div className="rounded-xl border border-border-strong bg-bg-card p-8 shadow-card md:flex md:items-center md:justify-between md:gap-8">
            <div>
              <p className="font-mono text-xs text-accent">Next step</p>
	              <h2 className="mt-3 text-2xl font-normal tracking-[-0.03em] text-text">
	                Start with the quick start once you know the shape you want
	              </h2>
	              <p className="mt-3 max-w-2xl text-sm leading-6 text-text-muted">
	                Do not linger in comparison mode longer than necessary. Once one path looks right, test it against your own schema and one real query.
	              </p>
            </div>
            <div className="mt-6 flex shrink-0 flex-wrap gap-3 md:mt-0">
              <Link
                href="/docs/quick-start"
                data-umami-event="cta_click"
                data-umami-event-target="docs_quick_start"
                data-umami-event-location="hero_primary"
                className={marketing.primaryButton}
              >
                Open quick start
              </Link>
              <Link
                href="/clickhouse-query-builder"
                className={marketing.secondaryButton}
              >
                See the query builder
              </Link>
            </div>
          </div>
        </section>
    </PageWrapper>
  );
}

/** The "best fit" and "choose hypequery when" lines on a comparison card. */
function HubNote({ href }: { href: string }) {
  const note = compareHubNote(href);
  if (!note) return null;
  return (
    <dl className="mt-5 space-y-3 border-t border-border pt-4 text-[13px] leading-5">
      <div>
        <dt className="font-mono text-[11px] text-text-dim">Best fit for</dt>
        <dd className="mt-1 text-text-muted">{note.bestFitFor}</dd>
      </div>
      <div>
        <dt className="font-mono text-[11px] text-accent">Choose hypequery when</dt>
        <dd className="mt-1 text-text-muted">{note.chooseHypequeryWhen}</dd>
      </div>
    </dl>
  );
}
