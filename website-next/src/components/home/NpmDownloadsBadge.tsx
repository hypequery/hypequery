'use client';

import { useState } from 'react';
import { NPM_BADGE_PACKAGES, type NpmDownloadCounts } from '@/lib/npm-downloads';
import './NpmDownloadsBadge.css';

// Counts come from the server (see `lib/npm-downloads.ts`), so the number is
// part of the HTML. This component only owns the hover/focus tooltip.
export function NpmDownloadsBadge({ counts }: { counts: NpmDownloadCounts }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const showTooltip = (hovered || focused) && !dismissed;

  // npm unreachable at render time: show the link without a stale or fake number.
  if (counts === null) {
    return (
      <a href="https://www.npmjs.com/org/hypequery" target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-2 rounded-lg border border-border-strong bg-bg-card px-3 font-mono text-xs text-text-muted transition hover:-translate-y-px hover:border-text focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent">
        <span className="font-semibold text-text">npm</span><span>@hypequery</span>
      </a>
    );
  }

  const total = counts.reduce((sum, count) => sum + count, 0);

  return (
    <div className="npm-download-badge relative inline-block" onMouseEnter={() => { setHovered(true); setDismissed(false); }} onMouseLeave={() => setHovered(false)}>
      <a href="https://www.npmjs.com/org/hypequery" target="_blank" rel="noreferrer" aria-describedby="npm-download-details" onFocus={() => { setFocused(true); setDismissed(false); }} onBlur={() => setFocused(false)} onKeyDown={(event) => { if (event.key === 'Escape') setDismissed(true); }} className="inline-flex h-8 items-center gap-2 rounded-lg border border-border-strong bg-bg-card px-3 font-mono text-xs text-text-muted transition hover:-translate-y-px hover:border-text focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent">
        <span className="font-semibold text-text">npm</span><span>downloads / month</span>
        <span className="border-l border-border pl-2 font-semibold text-text"><span className="inline-block min-w-[6ch]">{new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(total)}</span></span>
      </a>
      <div id="npm-download-details" role="tooltip" hidden={!showTooltip} className="npm-download-tooltip absolute left-0 top-[calc(100%+8px)] z-40 rounded-xl border border-border-strong bg-bg-card p-4 text-xs text-text shadow-lg">
        <p className="mb-3 font-medium">Monthly npm downloads</p>
        <div className="space-y-2">
          {NPM_BADGE_PACKAGES.map((name, index) => <div key={name} className="flex items-center justify-between gap-4"><span className="font-mono text-[11px] text-text-muted">{name}</span><span className="font-mono text-[11px] tabular-nums">{new Intl.NumberFormat('en').format(counts[index])}</span></div>)}
        </div>
      </div>
    </div>
  );
}
