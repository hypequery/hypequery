import Link from 'next/link';
import type { ReactNode } from 'react';
import Navigation from '@/components/Navigation';
import Footer from '@/components/Footer';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { withInlineCode } from '@/components/InlineCode';
import { OpenSourceBadge } from '@/components/home/OpenSourceBadge';
import { marketing } from '@/components/ui/marketing';
import type { BreadcrumbItem, FaqItem } from '@/lib/structured-data';

// Building blocks for hub pages: pages that answer a topic briefly and link
// down to every guide on it. Pages compose these rather than passing one big
// props object, so each hub can order its sections to fit its topic.

export type HubLink = {
  href: string;
  title: string;
  description: string;
};

type Cta = { href: string; label: string; target: string };

export function HubShell({
  path,
  breadcrumbs,
  eyebrow,
  title,
  lead,
  primaryCta,
  secondaryCta,
  definition,
  jsonLd,
  children,
}: {
  path: string;
  breadcrumbs: BreadcrumbItem[];
  eyebrow: string;
  title: string;
  lead: ReactNode;
  primaryCta: Cta;
  secondaryCta?: Cta;
  /** Answer-first definition shown right under the hero. */
  definition?: { term: string; body: ReactNode };
  jsonLd?: object[];
  children: ReactNode;
}) {
  return (
    <>
      {jsonLd?.map((item, index) => (
        <script key={index} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(item) }} />
      ))}
      <Navigation />
      <main className="min-h-screen bg-bg pt-[62px] text-text">
        <section className="border-b border-border">
          <div className={`${marketing.container} pb-14 pt-10 sm:pb-16 sm:pt-12`}>
            <Breadcrumbs items={breadcrumbs} currentPath={path} />
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <OpenSourceBadge />
              <p className={marketing.eyebrow}>{eyebrow}</p>
            </div>
            <h1 className={`mt-5 max-w-[980px] text-balance ${marketing.heroTitle}`}>{title}</h1>
            <div className={`mt-5 max-w-[720px] text-pretty ${marketing.heroLead}`}>{lead}</div>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                href={primaryCta.href}
                data-umami-event="cta_click"
                data-umami-event-target={primaryCta.target}
                data-umami-event-location="hub_hero_primary"
                className={marketing.primaryButton}
              >
                {primaryCta.label} <span aria-hidden="true">→</span>
              </Link>
              {secondaryCta ? (
                <Link
                  href={secondaryCta.href}
                  data-umami-event="cta_click"
                  data-umami-event-target={secondaryCta.target}
                  data-umami-event-location="hub_hero_secondary"
                  className={marketing.secondaryButton}
                >
                  {secondaryCta.label}
                </Link>
              ) : null}
            </div>
            {definition ? <HubDefinition term={definition.term}>{definition.body}</HubDefinition> : null}
          </div>
        </section>
        {children}
      </main>
      <Footer />
    </>
  );
}

/** A short "X is ..." block. Search engines and answer engines quote these. */
export function HubDefinition({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="mt-10 max-w-[860px] rounded-xl border border-border-strong bg-bg-card p-6 shadow-card">
      <p className="font-mono text-xs text-text-dim">Definition</p>
      <h2 className="mt-2 text-xl font-medium tracking-tight text-text">{term}</h2>
      <div className="mt-3 space-y-3 text-[15px] leading-7 text-text-muted">{children}</div>
    </div>
  );
}

export function HubSection({
  id,
  eyebrow,
  title,
  intro,
  band = false,
  children,
}: {
  id?: string;
  eyebrow?: string;
  title: string;
  intro?: ReactNode;
  band?: boolean;
  children?: ReactNode;
}) {
  return (
    <section id={id} className={band ? marketing.band : undefined}>
      <div className={`${marketing.container} py-14 sm:py-20`}>
        {eyebrow ? <p className={marketing.eyebrow}>{eyebrow}</p> : null}
        <h2 className={`mt-3 max-w-[820px] text-balance ${marketing.sectionTitle}`}>{title}</h2>
        {intro ? <div className="mt-4 max-w-[760px] space-y-4 text-body text-text-muted text-pretty">{intro}</div> : null}
        {children ? <div className="mt-10">{children}</div> : null}
      </div>
    </section>
  );
}

export function HubLinkGrid({ links, columns = 3 }: { links: HubLink[]; columns?: 2 | 3 }) {
  return (
    <div className={`grid gap-5 sm:grid-cols-2 ${columns === 3 ? 'lg:grid-cols-3' : ''}`}>
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="group rounded-xl border border-border bg-bg-card p-5 transition hover:-translate-y-0.5 hover:border-border-strong hover:shadow-card"
        >
          <h3 className="text-[17px] font-medium tracking-tight text-text">{link.title}</h3>
          <p className="mt-2 text-sm leading-6 text-text-muted">{link.description}</p>
          <p className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-accent group-hover:opacity-70">
            Read <span aria-hidden="true">→</span>
          </p>
        </Link>
      ))}
    </div>
  );
}

/** Two side-by-side columns, used for "lanes" like TypeScript and Python. */
export function HubLanes({ lanes }: { lanes: Array<{ title: string; intro: ReactNode; links: HubLink[] }> }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {lanes.map((lane) => (
        <div key={lane.title} className={marketing.card}>
          <h3 className={marketing.cardTitle}>{lane.title}</h3>
          <div className="mt-2 text-sm leading-6 text-text-muted">{lane.intro}</div>
          <ul className="mt-5 divide-y divide-border border-t border-border">
            {lane.links.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="group block py-3 transition hover:bg-bg-alt/60">
                  <span className="text-sm font-medium text-text group-hover:text-accent">{link.title}</span>
                  <span className="mt-0.5 block text-[13px] leading-5 text-text-muted">{link.description}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function HubTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: string[];
  rows: ReactNode[][];
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-bg-card shadow-card">
      <table className="w-full min-w-[860px] border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border bg-bg-alt/60">
            {columns.map((column) => (
              <th key={column} scope="col" className="px-4 py-3 font-mono text-xs font-medium text-text-dim">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-border last:border-b-0">
              {row.map((rawCell, cellIndex) => {
                const cell = typeof rawCell === 'string' ? withInlineCode(rawCell) : rawCell;
                return cellIndex === 0 ? (
                  <th key={cellIndex} scope="row" className="px-4 py-3 align-top text-sm font-medium text-text">
                    {cell}
                  </th>
                ) : (
                  <td
                    key={cellIndex}
                    className="px-4 py-3 align-top leading-6 text-text-muted"
                  >
                    {cell}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The vendor pages a comparison was checked against, grouped by vendor. */
export function HubSources({
  checkedOn,
  sources,
}: {
  checkedOn: string;
  sources: ReadonlyArray<{ vendor: string; urls: readonly string[] }>;
}) {
  return (
    <section className={`${marketing.container} pb-14`}>
      <h2 className="text-lg font-medium text-text">Sources</h2>
      <p className="mt-2 text-sm text-text-muted">Vendor pages used for this page, all read on {checkedOn}.</p>
      <dl className="mt-4 grid gap-x-8 gap-y-3 text-[13px] sm:grid-cols-2">
        {sources.map((source) => (
          <div key={source.vendor}>
            <dt className="font-medium text-text">{source.vendor}</dt>
            {source.urls.map((url) => (
              <dd key={url} className="break-all text-text-muted">
                <a href={url} rel="noopener nofollow" className="hover:text-accent">
                  {url.replace(/^https:\/\//, '')}
                </a>
              </dd>
            ))}
          </div>
        ))}
      </dl>
    </section>
  );
}

export function HubFaq({ items }: { items: readonly FaqItem[] }) {
  return (
    <div className="grid gap-5 md:grid-cols-2">
      {items.map((item) => (
        <div key={item.question} className={marketing.card}>
          <h3 className="text-[17px] font-medium tracking-tight text-text">{item.question}</h3>
          <p className="mt-3 text-sm leading-6 text-text-muted">{item.answer}</p>
        </div>
      ))}
    </div>
  );
}
