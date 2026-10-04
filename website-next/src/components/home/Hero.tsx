'use client';

import Link from 'next/link';
import { DeployWaitlist } from './DeployWaitlist';
import { InstallCommand } from './InstallCommand';
import { NpmDownloadsBadge } from './NpmDownloadsBadge';

export function Hero() {

  return (
    <section className="mx-auto max-w-[1280px] px-5 pb-8 pt-8 sm:px-8 sm:pt-10">
      <div className="w-full">
        <NpmDownloadsBadge />
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
