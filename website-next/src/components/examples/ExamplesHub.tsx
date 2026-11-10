import { Suspense } from 'react';
import { marketing } from '@/components/ui/marketing';
import PageWrapper from '@/components/PageWrapper';
import ExamplesGallery from '@/components/examples/ExamplesGallery';
import type { RegistryEntry } from '@/lib/examples';
import { absoluteUrl } from '@/lib/site';

interface Props {
  kind: 'example' | 'recipe' | 'guide';
  eyebrow: string;
  title: string;
  lead: string;
  entries: RegistryEntry[];
  emptyCopy: string;
}

export default function ExamplesHub({ kind, eyebrow, title, lead, entries, emptyCopy }: Props) {
  const path = kind === 'example' ? '/examples' : kind === 'recipe' ? '/recipes' : '/guides';
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [{ '@type': 'ListItem', position: 1, name: eyebrow, item: absoluteUrl(path).toString() }],
  };
  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: entries.map((entry, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: entry.manifest.title,
      url: absoluteUrl(`${path}/${entry.manifest.slug}`).toString(),
    })),
  };

  return (
    <PageWrapper>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(itemList) }} />
      <section className="border-b border-border">
        <div className={`${marketing.container} pb-14 pt-12 sm:pb-16 sm:pt-16`}>
          <p className={marketing.eyebrow}>{eyebrow}</p>
          <h1 className={`mt-5 max-w-[980px] ${marketing.heroTitle}`}>{title}</h1>
          <p className={`mt-5 max-w-[760px] ${marketing.heroLead}`}>{lead}</p>
          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-border bg-bg-card p-5 shadow-card">
              <p className="font-mono text-xs text-text-dim">Data</p>
              <p className="mt-2 text-xl font-medium tracking-tight text-text">One seeded ClickHouse, 1M events</p>
            </div>
            <div className="rounded-xl border border-border bg-bg-card p-5 shadow-card">
              <p className="font-mono text-xs text-text-dim">Trust</p>
              <p className="mt-2 text-xl font-medium tracking-tight text-text">Smoke-tested on every change</p>
            </div>
            <div className="rounded-xl border border-border bg-bg-card p-5 shadow-card">
              <p className="font-mono text-xs text-text-dim">Start</p>
              <p className="mt-2 font-mono text-sm text-text">{kind === 'guide' ? 'Copy the SQL, it already ran' : 'npx @hypequery/cli create <slug> -y'}</p>
            </div>
          </div>
        </div>
      </section>
      <section className={`${marketing.container} py-14 sm:py-20`}>
        <Suspense fallback={<p className="font-mono text-xs text-text-dim">Loading…</p>}>
          <ExamplesGallery entries={entries} emptyCopy={emptyCopy} />
        </Suspense>
      </section>
    </PageWrapper>
  );
}
