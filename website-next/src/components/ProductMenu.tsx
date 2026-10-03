'use client';

import Link from 'next/link';
import * as Popover from '@radix-ui/react-popover';
import { ChevronDown, Cloud } from 'lucide-react';
import { SiPython, SiTypescript } from 'react-icons/si';

const itemClassName = 'group flex items-start gap-3 rounded-lg p-3 transition hover:bg-bg-alt focus-visible:bg-bg-alt focus-visible:outline-none';

export function ProductMenu() {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="group inline-flex min-h-9 items-center gap-1.5 text-[13.5px] font-medium text-text-muted transition hover:text-text data-[state=open]:text-text">
          Product <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180" aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={10} className="z-[60] w-[min(370px,calc(100vw-24px))] rounded-xl border border-border-strong bg-bg-card p-2 text-text shadow-xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out">
          <p className="px-3 pb-1 pt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-text-muted">Explore product</p>
          <Popover.Close asChild>
            <Link href="/docs/query-building/basics" className={itemClassName}>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-bg-alt/70 text-[#3178c6]"><SiTypescript className="h-5 w-5" aria-hidden="true" /></span>
              <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-text">Query builder</span><span className="mt-0.5 block text-xs leading-5 text-text-muted">Build typed ClickHouse queries in TypeScript.</span></span>
            </Link>
          </Popover.Close>
          <Popover.Close asChild>
            <Link href="/docs/datasets/overview" className={itemClassName}>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center gap-1 rounded-lg border border-border bg-bg-alt/70"><SiTypescript className="h-4 w-4 text-[#3178c6]" aria-label="TypeScript" /><SiPython className="h-4 w-4 text-[#3776ab]" aria-label="Python" /></span>
              <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-text">Datasets</span><span className="mt-0.5 block text-xs leading-5 text-text-muted">Define metrics, dimensions, and tenant rules once.</span></span>
            </Link>
          </Popover.Close>
          <div className="mx-3 my-1 border-t border-border" />
          <Popover.Close asChild>
            <Link href="/docs/reference/api/cli#hypequery-deploy-cloud" className={itemClassName}>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-accent/10 text-accent"><Cloud className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" /></span>
              <span className="min-w-0 flex-1"><span className="flex items-center gap-2 text-sm font-semibold text-text">Cloud <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">Early access</span></span><span className="mt-0.5 block text-xs leading-5 text-text-muted">Deploy hosted APIs and MCP tools.</span></span>
            </Link>
          </Popover.Close>
          <div className="mx-3 mt-1 border-t border-border" />
          <Popover.Close asChild>
            <Link href="/docs" className="block rounded-lg px-3 py-2.5 text-xs font-semibold text-accent transition hover:bg-bg-alt focus-visible:bg-bg-alt focus-visible:outline-none">View all docs <span aria-hidden="true">→</span></Link>
          </Popover.Close>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
