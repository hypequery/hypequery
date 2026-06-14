'use client';

import Link from 'next/link';

export default function Navigation({ hasBanner = false }: { hasBanner?: boolean }) {
  return (
    <nav className={`fixed ${hasBanner ? 'top-[42px]' : 'top-0'} left-0 right-0 z-50 h-[62px] flex items-center justify-between px-5 lg:px-8 backdrop-blur-[14px] bg-bg/80 border-b border-border`}>
      <Link href="/" className="font-mono text-[15px] font-bold text-text tracking-tight">
        &gt; hypequery
      </Link>
      <div className="flex items-end gap-7">
        <Link href="/docs" className="text-[13.5px] font-medium text-text-muted hover:text-text transition">
          Docs
        </Link>
        <a
          href="https://github.com/hypequery/hypequery"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[13.5px] font-medium text-text-muted hover:text-text transition"
        >
          GitHub
        </a>
      </div>
    </nav>
  );
}
