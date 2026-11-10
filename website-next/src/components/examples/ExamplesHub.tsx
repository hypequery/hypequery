import { Suspense } from 'react';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { marketing } from '@/components/ui/marketing';
import PageWrapper from '@/components/PageWrapper';
import ExamplesGallery from '@/components/examples/ExamplesGallery';
import ExamplePicker, { type ExamplePickerOption } from '@/components/examples/ExamplePicker';
import { createCommand, type RegistryEntry } from '@/lib/examples';
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
  const pickerOptions: ExamplePickerOption[] = entries.flatMap((entry) => {
    const { manifest } = entry;
    const command = createCommand(entry);
    return command && manifest.kind !== 'guide' ? [{ slug: manifest.slug, kind: manifest.kind, language: manifest.language, command }] : [];
  });
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
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(itemList) }} />
      <section className="border-b border-border">
        <div className={`${marketing.container} pb-14 pt-12 sm:pb-16 sm:pt-16`}>
          <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: eyebrow }]} currentPath={path} />
          <h1 className={`mt-6 max-w-[980px] ${marketing.heroTitle}`}>{title}</h1>
          <p className={`mt-5 max-w-[760px] ${marketing.heroLead}`}>{lead}</p>
          {pickerOptions.length > 0 && (
            <ExamplePicker
              options={pickerOptions}
              label={kind === 'recipe' ? 'Start from a recipe' : 'Start from an example'}
              location={kind === 'recipe' ? 'hub_recipe' : 'hub_example'}
              defaultSlug={kind === 'recipe' ? 'p95-latency' : 'nextjs-dashboard'}
              className="mt-7"
            />
          )}
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
