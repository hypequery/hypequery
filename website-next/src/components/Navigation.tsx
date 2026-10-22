'use client';

import Link from 'next/link';
import Image from 'next/image';
import { DeployWaitlist } from './home/DeployWaitlist';
import { ProductMenu } from './ProductMenu';

export default function Navigation({ hasBanner = false }: { hasBanner?: boolean }) {
  return (
    <nav className={`fixed ${hasBanner ? 'top-[42px]' : 'top-0'} left-0 right-0 z-50 h-[62px] backdrop-blur-[14px] bg-bg/80 border-b border-border`}>
      <div className="mx-auto flex h-full max-w-[1280px] items-center justify-between px-5 sm:px-8">
        <Link href="/" className="inline-flex shrink-0 items-center gap-2 rounded-sm font-mono text-[15px] font-bold text-text tracking-tight focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent">
          <Image
            src="/mascot/hypequery-logo-compact-blink.svg"
            alt=""
            width={32}
            height={36}
            unoptimized
            className="h-6 w-auto shrink-0 dark:brightness-0 dark:invert"
          />
          <span>hypequery</span>
        </Link>
        <div className="flex items-center gap-3 sm:gap-8">
        <ProductMenu />
        <Link href="/docs" className="nav-desktop-only text-[13.5px] font-medium text-text-muted transition hover:text-text">
          Docs
        </Link>
        <a
          href="https://github.com/hypequery/hypequery"
          target="_blank"
          rel="noopener noreferrer"
          className="nav-desktop-only text-[13.5px] font-medium text-text-muted transition hover:text-text"
        >
          GitHub
        </a>
        <DeployWaitlist location="nav" compactLabel className="inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-lg bg-accent px-3 text-xs font-semibold text-white transition hover:opacity-85 dark:text-[#0c0e14]" />
        </div>
      </div>
    </nav>
  );
}
