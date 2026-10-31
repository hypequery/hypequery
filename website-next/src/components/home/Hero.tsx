'use client';

import Link from 'next/link';
import { DeployWaitlist } from './DeployWaitlist';
import { SetupCommand } from './SetupCommand';
import { SiClickhouse } from 'react-icons/si';
import { Inter } from 'next/font/google';
import { NpmDownloadsBadge } from './NpmDownloadsBadge';
import { OpenSourceBadge } from './OpenSourceBadge';
import { marketing } from '../ui/marketing';

// ClickHouse's wordmark is set in Inter; load just the bold weight for it.
const clickhouseWordmark = Inter({ subsets: ['latin'], weight: '700', display: 'swap' });

export function Hero() {
  return (
    <section className="mx-auto max-w-[1280px] px-5 pb-8 pt-8 sm:px-8 sm:pt-10">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <NpmDownloadsBadge />
          <OpenSourceBadge />
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
        <p className="text-body-lg mt-5 max-w-[660px] text-text-muted">Define your metrics once, in the codebase you already have. Dashboards, APIs, and AI agents all answer from that one definition. Run it in your own backend, or on hypequery cloud.</p>
        {/* Lead with what works today: the open-source path. Cloud is waitlist-only, so it's the second button. */}
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Link href="/docs/quick-start" className={marketing.primaryButton}>Get started <span aria-hidden="true">→</span></Link>
          <DeployWaitlist location="hero" className={marketing.secondaryButton} />
        </div>
        <SetupCommand className="mt-4" />
      </div>
    </section>
  );
}
