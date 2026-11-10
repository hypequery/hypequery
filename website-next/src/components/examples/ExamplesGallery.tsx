'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import ExampleCard from '@/components/examples/ExampleCard';
import { collectFacets, filterEntries, label, type RegistryEntry } from '@/lib/examples-core';

/**
 * Facets live in the query string (`?stack=nextjs&useCase=dashboards`) so a
 * filtered view is shareable, while the page's canonical stays on the bare
 * hub URL. Filtering is client-side over the static registry.
 */
export default function ExamplesGallery({ entries, emptyCopy }: { entries: Pick<RegistryEntry, 'manifest'>[]; emptyCopy: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const selection = {
    stack: params.get('stack'),
    useCase: params.get('useCase'),
    language: params.get('language'),
  };
  const facets = collectFacets(entries);
  const visible = filterEntries(entries, selection);
  const active = Object.values(selection).some(Boolean);

  const setParam = (key: keyof typeof selection, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value === null || selection[key] === value) next.delete(key);
    else next.set(key, value);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const facetGroup = (title: string, key: keyof typeof selection, values: string[]) =>
    values.length > 1 || selection[key] ? (
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 font-mono text-[11px] uppercase tracking-[0.15em] text-text-dim">{title}</span>
        {values.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={selection[key] === value}
            onClick={() => setParam(key, value)}
            className={`rounded-full border px-3 py-1 text-xs transition ${
              selection[key] === value
                ? 'border-text bg-text text-bg'
                : 'border-border text-text-muted hover:border-border-strong hover:text-text'
            }`}
          >
            {label(value)}
          </button>
        ))}
      </div>
    ) : null;

  if (entries.length === 0) {
    return <p className="rounded-xl border border-dashed border-border p-8 text-sm leading-6 text-text-muted">{emptyCopy}</p>;
  }

  return (
    <div>
      <div className="flex flex-col gap-3">
        {facetGroup('Stack', 'stack', facets.stack)}
        {facetGroup('Use case', 'useCase', facets.useCases)}
        {facetGroup('Language', 'language', facets.languages)}
        {active && (
          <div>
            <Link href={pathname} replace scroll={false} className="font-mono text-xs text-accent hover:opacity-70">
              Clear filters
            </Link>
          </div>
        )}
      </div>
      <p className="mt-6 font-mono text-xs text-text-dim" aria-live="polite">
        {visible.length} of {entries.length}
      </p>
      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        {visible.map((entry) => (
          <ExampleCard key={entry.manifest.slug} entry={entry} />
        ))}
      </div>
      {visible.length === 0 && (
        <p className="mt-6 text-sm text-text-muted">Nothing matches that combination yet. Clear a filter or open an issue to request one.</p>
      )}
    </div>
  );
}
