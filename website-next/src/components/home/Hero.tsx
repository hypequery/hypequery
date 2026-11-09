'use client';

import Link from 'next/link';
import { DeployWaitlist } from './DeployWaitlist';
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
        <h1 className="mt-5 text-[clamp(2.25rem,4.6vw,4rem)] font-normal leading-[1.04] tracking-[-0.05em] text-text">Connect{' '}
          <span className="whitespace-nowrap">
            {/* ClickHouse yellow on a black tile, like its app icon, so the brand colour shows in light mode too. */}
            <span className="mr-[0.14em] inline-flex h-[0.86em] w-[0.86em] items-center justify-center rounded-[0.16em] bg-[#161517] align-[-0.1em]" aria-hidden="true">
              <SiClickhouse className="h-[0.6em] w-[0.6em] text-[#faff69]" />
            </span>
            <span className={`${clickhouseWordmark.className} font-bold tracking-[-0.045em]`}>ClickHouse</span>.
          </span>{' '}
          <span className="whitespace-nowrap">Ship analytics.</span>
        </h1>
        <p className="text-body-lg mt-5 max-w-[660px] text-text-muted">Embedded analytics and agents on a semantic layer you define in code. Run it in your own backend today. hypequery cloud, the hosted option, is in early access.</p>
        {/* Lead with what works today: the open-source path. Cloud is waitlist-only, so it's the second button. */}
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Link href="/docs" className={marketing.primaryButton}>Get started <span aria-hidden="true">→</span></Link>
          <DeployWaitlist location="hero" className={marketing.secondaryButton} />
        </div>
        <SetupCommand className="mt-4" />
      </div>
    </section>
  );
}
