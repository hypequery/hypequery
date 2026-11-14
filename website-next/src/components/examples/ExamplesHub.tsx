import { Suspense } from 'react';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { marketing } from '@/components/ui/marketing';
import PageWrapper from '@/components/PageWrapper';
import ExampleCard from '@/components/examples/ExampleCard';
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
        {/*
          ExamplesGallery reads facets from the query string, so a static build
          renders only this fallback into the HTML. Render every card here so
          crawlers and no-JS readers see the full list; the client gallery
          replaces it with the filterable version on hydration.
        */}
        <Suspense
          fallback={
            entries.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border p-8 text-sm leading-6 text-text-muted">{emptyCopy}</p>
            ) : (
              <div className="grid gap-6 lg:grid-cols-2">
                {entries.map(({ manifest }) => (
                  <ExampleCard key={manifest.slug} entry={{ manifest }} />
                ))}
              </div>
            )
          }
        >
          <ExamplesGallery entries={entries.map(({ manifest }) => ({ manifest }))} emptyCopy={emptyCopy} />
        </Suspense>
      </section>
    </PageWrapper>
  );
}
