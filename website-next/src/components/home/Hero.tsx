'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { DeployWaitlist } from './DeployWaitlist';
import { InstallCommand } from './InstallCommand';

export function Hero() {
  const [downloads, setDownloads] = useState<number | null>(null);

  useEffect(() => {
    fetch('https://api.npmjs.org/downloads/point/last-month/@hypequery/clickhouse')
      .then((response) => response.json())
      .then((data: { downloads?: number }) => setDownloads(typeof data.downloads === 'number' ? data.downloads : null))
      .catch(() => setDownloads(null));
  }, []);

  return (
    <section className="mx-auto max-w-[1280px] px-5 pb-8 pt-8 sm:px-8 sm:pt-10">
      <div className="w-full">
        <a href="https://www.npmjs.com/package/@hypequery/clickhouse" target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-2 rounded-lg border border-border-strong bg-bg-card px-3 font-mono text-xs text-text-muted transition hover:-translate-y-px hover:border-text"><span className="font-semibold text-text">npm</span><span>downloads / month</span><span className="border-l border-border pl-2 font-semibold text-text">{downloads === null ? <span className="inline-block h-3 w-8 animate-pulse rounded bg-text/15 align-middle" aria-label="Loading download count" /> : new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(downloads)}</span></a>
        <h1 className="whitespace-nowrap text-[clamp(1.625rem,5.4vw,4.6rem)] font-normal leading-[1.04] tracking-[-0.05em] text-text">Ship analytics on <em className="font-semibold italic">ClickHouse.</em></h1>
        <p className="text-body-lg mt-4 max-w-[660px] text-text-muted">Model your data once in code, then ship APIs, MCP tools, and dashboards from the same definitions.</p>
        <div className="mt-7 flex flex-wrap items-center gap-4">
          <DeployWaitlist location="hero" className="inline-flex min-h-12 items-center gap-3 rounded-lg bg-accent px-5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:opacity-90 dark:text-[#0c0e14]" />
          <Link href="/docs/quick-start" className="inline-flex min-h-12 items-center text-sm font-semibold text-text transition hover:text-accent">Get started</Link>
        </div>
        <InstallCommand className="mt-4" />
      </div>

    </section>
  );
}
