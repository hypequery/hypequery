import Link from 'next/link';
import { entryHref, kindLabel, label, type RegistryEntry } from '@/lib/examples-core';

/** Cards render from the manifest alone, so client lists never need README or source bodies. */
export default function ExampleCard({ entry, compact = false }: { entry: Pick<RegistryEntry, 'manifest'>; compact?: boolean }) {
  const { manifest } = entry;
  return (
    <Link
      href={entryHref(entry)}
      className="group flex h-full flex-col rounded-xl border border-border bg-bg-card p-5 transition hover:-translate-y-0.5 hover:border-border-strong hover:shadow-card"
    >
      <p className="font-mono text-xs text-text-dim">
        {kindLabel(manifest.kind)} · {manifest.kind === 'guide' ? `ClickHouse ${manifest.clickhouseVersion}` : label(manifest.language)}
      </p>
      <h3 className={`mt-3 ${compact ? 'text-[17px]' : 'text-lg'} font-medium tracking-tight text-text`}>{manifest.title}</h3>
      <p className="mt-2 text-sm leading-6 text-text-muted">{manifest.outcome}</p>
      <div className="mt-5 flex flex-wrap gap-2">
        {(manifest.kind === 'guide' ? manifest.functionPages : [...manifest.stack, ...manifest.useCases]).map((tag) => (
          <span key={tag} className="rounded-md border border-border px-2 py-0.5 font-mono text-[11px] text-text-muted">
            {label(tag)}
          </span>
        ))}
      </div>
      <p className="mt-auto inline-flex items-center gap-1.5 pt-5 text-xs font-medium text-accent underline-offset-4 group-hover:underline">
        Open {kindLabel(manifest.kind).toLowerCase()} <span aria-hidden="true">→</span>
      </p>
    </Link>
  );
}
