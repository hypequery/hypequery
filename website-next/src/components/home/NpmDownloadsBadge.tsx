'use client';

import { useEffect, useState } from 'react';
import './NpmDownloadsBadge.css';

const PACKAGES = ['@hypequery/clickhouse', '@hypequery/datasets'] as const;

export function NpmDownloadsBadge() {
  const [counts, setCounts] = useState<number[] | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const showTooltip = (hovered || focused) && !dismissed;
  const total = counts?.reduce((sum, count) => sum + count, 0) ?? null;

  useEffect(() => {
    const controller = new AbortController();
    Promise.all(PACKAGES.map(async (name) => {
      const response = await fetch(`https://api.npmjs.org/downloads/point/last-month/${name}`, { signal: controller.signal });
      if (!response.ok) throw new Error('npm download count unavailable');
      const data: { downloads?: number } = await response.json();
      if (typeof data.downloads !== 'number' || !Number.isFinite(data.downloads) || data.downloads < 0) {
        throw new Error('Invalid npm download count');
      }
      return data.downloads;
    }))
      .then((downloads) => { if (!controller.signal.aborted) setCounts(downloads); })
      .catch(() => { if (!controller.signal.aborted) setCounts(null); });
    return () => controller.abort();
  }, []);

  return (
    <div className="npm-download-badge relative inline-block" onMouseEnter={() => { setHovered(true); setDismissed(false); }} onMouseLeave={() => setHovered(false)}>
      <a href="https://www.npmjs.com/org/hypequery" target="_blank" rel="noreferrer" aria-describedby="npm-download-details" onFocus={() => { setFocused(true); setDismissed(false); }} onBlur={() => setFocused(false)} onKeyDown={(event) => { if (event.key === 'Escape') setDismissed(true); }} className="inline-flex h-8 items-center gap-2 rounded-lg border border-border-strong bg-bg-card px-3 font-mono text-xs text-text-muted transition hover:-translate-y-px hover:border-text focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent">
        <span className="font-semibold text-text">npm</span><span>downloads / month</span>
        <span className="border-l border-border pl-2 font-semibold text-text">{total === null ? <span className="inline-block h-3 w-8 animate-pulse rounded bg-text/15 align-middle" aria-label="Loading download count" /> : new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(total)}</span>
      </a>
      <div id="npm-download-details" role="tooltip" hidden={!showTooltip} className="npm-download-tooltip absolute left-0 top-[calc(100%+8px)] z-40 rounded-xl border border-border-strong bg-bg-card p-4 text-xs text-text shadow-lg">
        <p className="mb-3 font-medium">Monthly npm downloads</p>
        <div className="space-y-2">
          {PACKAGES.map((name, index) => <div key={name} className="flex items-center justify-between gap-4"><span className="font-mono text-[11px] text-text-muted">{name}</span><span className="font-mono text-[11px] tabular-nums">{counts ? new Intl.NumberFormat('en').format(counts[index]) : '—'}</span></div>)}
        </div>
      </div>
    </div>
  );
}
