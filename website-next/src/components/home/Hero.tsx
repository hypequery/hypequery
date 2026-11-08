'use client';

import Link from 'next/link';
import { SetupCommand } from './SetupCommand';
import { SiClickhouse } from 'react-icons/si';
import { Inter } from 'next/font/google';
import { NpmDownloadsBadge } from './NpmDownloadsBadge';
import type { NpmDownloadCounts } from '@/lib/npm-downloads';
import { OpenSourceBadge } from './OpenSourceBadge';
import { marketing } from '../ui/marketing';

// ClickHouse's wordmark is set in Inter; load just the bold weight for it.
const clickhouseWordmark = Inter({ subsets: ['latin'], weight: '700', display: 'swap' });

export function Hero({ npmDownloads }: { npmDownloads: NpmDownloadCounts }) {
  return (
    <section className="mx-auto max-w-[1280px] px-5 pb-8 pt-8 sm:px-8 sm:pt-10">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <NpmDownloadsBadge counts={npmDownloads} />
          <OpenSourceBadge />
        </div>
        <h1 className="mt-5 text-[clamp(2rem,3.6vw,3.25rem)] font-normal leading-[1.06] tracking-[-0.045em] text-text">Connect{' '}
          {/* Plain inline text (not flex) so the wordmark shares the heading's baseline. */}
          <span className="whitespace-nowrap">
            {/* ClickHouse yellow on a black tile, like its app icon, so the brand colour shows in light mode too. */}
            <span className="ml-[0.1em] mr-[0.14em] inline-flex h-[0.8em] w-[0.8em] items-center justify-center rounded-[0.16em] bg-[#161517] align-[0.09em]" aria-hidden="true">
              <SiClickhouse className="h-[0.56em] w-[0.56em] text-[#faff69]" />
            </span>
            <span className={`${clickhouseWordmark.className} font-bold tracking-[-0.045em]`}>ClickHouse</span>.
          </span>{' '}
          <span className="whitespace-nowrap">Ship analytics.</span>
        </h1>
        <p className="text-body-lg mt-5 max-w-[660px] text-text-muted">Define your metrics once, in TypeScript or Python. Serve them to dashboards, APIs and AI agents, with every customer seeing only their own data.</p>
        {/* The open-source path only. Cloud has its own section further down. */}
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Link href="/docs/quick-start" className={marketing.primaryButton}>Get started <span aria-hidden="true">→</span></Link>
          <a href="https://github.com/hypequery/hypequery" target="_blank" rel="noopener noreferrer" className={marketing.secondaryButton}>View on GitHub</a>
        </div>
        <SetupCommand className="mt-4" />
      </div>
    </section>
  );
}
