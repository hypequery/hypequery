'use client';

import Link from 'next/link';
import { DeployWaitlist } from './DeployWaitlist';
import { SetupCommand } from './SetupCommand';
import { SiClickhouse, SiGithub } from 'react-icons/si';
import { Inter } from 'next/font/google';
import { NpmDownloadsBadge } from './NpmDownloadsBadge';

// ClickHouse's wordmark is set in Inter; load just the bold weight for it.
const clickhouseWordmark = Inter({ subsets: ['latin'], weight: '700', display: 'swap' });

export function Hero() {
  return (
    <section className="mx-auto max-w-[1280px] px-5 pb-8 pt-8 sm:px-8 sm:pt-10">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <NpmDownloadsBadge />
          <a href="https://github.com/hypequery/hypequery" target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-2 rounded-lg border border-border-strong bg-bg-card px-3 font-mono text-xs text-text-muted transition hover:-translate-y-px hover:border-text focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent">
            <SiGithub className="h-3.5 w-3.5 text-text" aria-hidden="true" /><span className="font-semibold text-text">Open source</span><span className="border-l border-border pl-2">Apache 2.0</span>
          </a>
        </div>
        <h1 className="mt-5 text-[clamp(2.25rem,4.6vw,4rem)] font-normal leading-[1.04] tracking-[-0.05em] text-text">The analytics layer for{' '}
          <span className="ml-[0.18em] inline-flex items-center gap-[0.14em] whitespace-nowrap align-[-0.06em]">
            {/* ClickHouse yellow on a black tile, like its app icon, so the brand colour shows in light mode too. */}
            <span className="flex h-[0.86em] w-[0.86em] shrink-0 items-center justify-center rounded-[0.16em] bg-[#161517]" aria-hidden="true">
              <SiClickhouse className="h-[0.6em] w-[0.6em] text-[#faff69]" />
            </span>
            <span className={`${clickhouseWordmark.className} font-bold tracking-[-0.045em]`}>ClickHouse</span>
          </span>
        </h1>
        <p className="text-body-lg mt-5 max-w-[660px] text-text-muted">Ship embedded dashboards, chat, and AI agents that all answer from one definition of your metrics. Build it with AI or in code. Every customer only sees their own data.</p>
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <DeployWaitlist location="hero" className="inline-flex min-h-12 items-center gap-3 rounded-lg bg-accent px-5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:opacity-90 dark:text-[#0c0e14]" />
          <Link href="/docs/quick-start" className="inline-flex min-h-12 items-center rounded-lg border border-border-strong bg-bg-card px-5 text-sm font-semibold text-text transition hover:-translate-y-0.5 hover:border-text">Start open source</Link>
        </div>
        <SetupCommand className="mt-4" />
      </div>
    </section>
  );
}
