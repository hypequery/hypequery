import Link from 'next/link';
import { entryHref, kindLabel, label, type RegistryEntry } from '@/lib/examples';

export default function ExampleCard({ entry, compact = false }: { entry: RegistryEntry; compact?: boolean }) {
  const { manifest } = entry;
  return (
    <Link
      href={entryHref(entry)}
      className="group flex h-full flex-col rounded-xl border border-border bg-bg-card p-6 transition hover:-translate-y-0.5 hover:border-border-strong hover:shadow-card"
    >
      <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-text-dim">
        {kindLabel(manifest.kind)} · {manifest.kind === 'guide' ? `ClickHouse ${manifest.clickhouseVersion}` : label(manifest.language)}
      </p>
      <h3 className={`mt-3 ${compact ? 'text-lg' : 'text-xl'} font-medium tracking-tight text-text`}>{manifest.title}</h3>
      <p className="mt-3 text-sm leading-6 text-text-muted">{manifest.outcome}</p>
      <div className="mt-5 flex flex-wrap gap-2">
        {(manifest.kind === 'guide' ? manifest.functionPages : [...manifest.stack, ...manifest.useCases]).map((tag) => (
          <span key={tag} className="border border-border px-2.5 py-1 font-mono text-[11px] text-text-muted">
            {label(tag)}
          </span>
        ))}
      </div>
      <p className="mt-auto pt-5 font-mono text-xs text-accent group-hover:opacity-70">
        Open {kindLabel(manifest.kind).toLowerCase()} <span aria-hidden="true">→</span>
      </p>
    </Link>
  );
}
