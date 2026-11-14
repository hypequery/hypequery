import type { Metadata } from 'next';
import Link from 'next/link';
import CodeWindow from '@/components/CodeWindow';
import { HubLinkGrid, HubSection } from '@/components/hub-page';
import { marketing } from '@/components/ui/marketing';
import { otherSemanticLayerPages } from '@/data/semantic-layer-pages';
import { searchTitle } from '@/lib/page-title';
import { absoluteUrl, ogImage } from '@/lib/site';
import type { BreadcrumbItem } from '@/lib/structured-data';

// Pieces shared by the /semantic-layer hub and its spokes.

export function spokeMetadata({ path, title, description }: { path: string; title: string; description: string }): Metadata {
  return {
    title: searchTitle(title),
    description,
    alternates: { canonical: absoluteUrl(path) },
    openGraph: { type: 'article', url: absoluteUrl(path), title: `${title} | hypequery`, description, images: ogImage(title) },
    twitter: { card: 'summary_large_image', title: `${title} | hypequery`, description },
  };
}

export function spokeArticleJsonLd({
  path,
  title,
  description,
  dateModified,
}: {
  path: string;
  title: string;
  description: string;
  dateModified: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: title,
    description,
    url: absoluteUrl(path).toString(),
    dateModified,
    author: { '@type': 'Organization', name: 'hypequery' },
    publisher: { '@type': 'Organization', name: 'hypequery', url: absoluteUrl('/').toString() },
  };
}

export function spokeBreadcrumbs(label: string): BreadcrumbItem[] {
  return [{ label: 'Home', href: '/' }, { label: 'Semantic layer', href: '/semantic-layer' }, { label }];
}

export const inlineLink =
  'font-medium text-text underline decoration-border-strong underline-offset-4 transition hover:text-accent hover:decoration-accent';

export const inlineCode = 'font-mono text-[0.92em] text-text';

type CodeSample = { code: string; filename: string; language?: string };

/** Two code samples side by side: usually a definition and the query that reads it. */
export function CodePair({ left, right }: { left: CodeSample; right: CodeSample }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
      <CodeWindow code={left.code} filename={left.filename} language={left.language} />
      <CodeWindow code={right.code} filename={right.filename} language={right.language} />
    </div>
  );
}

/** The hub and the other spokes, plus the ClickHouse page for readers who want the hypequery side. */
export function SemanticLayerGuides({ currentHref }: { currentHref: string }) {
  const links = [
    ...otherSemanticLayerPages(currentHref),
    {
      href: '/clickhouse-semantic-layer',
      title: 'ClickHouse semantic layer',
      description: 'Define datasets, measures and tenant keys for ClickHouse in TypeScript or Python.',
    },
    {
      href: '/compare/hypequery-vs-cube',
      title: 'hypequery vs Cube',
      description: 'A code-first library compared with a standalone semantic layer service.',
    },
  ];
  return (
    <HubSection eyebrow="Guides" title="More on semantic layers">
      <HubLinkGrid links={links} />
    </HubSection>
  );
}

export function SemanticLayerNextStep({ location }: { location: string }) {
  return (
    <section className={`${marketing.container} pb-20`}>
      <div className="rounded-xl border border-border-strong bg-bg-card p-8 shadow-card md:flex md:items-center md:justify-between md:gap-8">
        <div>
          <p className={marketing.eyebrow}>Next step</p>
          <h2 className="mt-3 text-2xl font-normal tracking-[-0.03em] text-text">Define a semantic layer in your own codebase</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-text-muted">
            hypequery datasets are TypeScript or Python files: dimensions, measures, joins and a tenant key, served to
            your API, React hooks and AI agents over MCP. Open source, for ClickHouse.
          </p>
        </div>
        <div className="mt-6 flex shrink-0 flex-wrap gap-3 md:mt-0">
          <Link
            href="/docs/datasets/overview"
            data-umami-event="cta_click"
            data-umami-event-target="docs_datasets_overview"
            data-umami-event-location={location}
            className={marketing.primaryButton}
          >
            Read the datasets docs <span aria-hidden="true">→</span>
          </Link>
          <Link href="/clickhouse-semantic-layer" className={marketing.secondaryButton}>
            ClickHouse semantic layer
          </Link>
        </div>
      </div>
    </section>
  );
}
