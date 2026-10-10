'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { ChevronDown, Cloud } from 'lucide-react';
import { SiPython, SiTypescript } from 'react-icons/si';

type Offering = {
  name: string;
  pitch: string;
  href: string;
  icon: ReactNode;
  badge?: string;
  links: { label: string; href: string }[];
};

// Three offerings, given equal weight: the query builder, the analytics layer in code, and Cloud.
const OFFERINGS: Offering[] = [
  {
    name: 'Query builder',
    pitch: 'Type-safe ClickHouse queries in TypeScript, typed from your schema.',
    href: '/docs/query-building/basics',
    icon: <SiTypescript className="h-5 w-5 text-[#3178c6]" aria-hidden="true" />,
    links: [
      { label: 'Generate types from your schema', href: '/docs/schemas' },
      { label: 'Joins and aggregations', href: '/docs/query-building/joins' },
      { label: 'Embedded chDB', href: '/docs/chdb' },
    ],
  },
  {
    name: 'Datasets',
    pitch: 'The analytics layer in your codebase.',
    href: '/docs/datasets/overview',
    icon: <><SiTypescript className="h-4 w-4 text-[#3178c6]" aria-label="TypeScript" /><SiPython className="h-4 w-4 text-[#3776ab]" aria-label="Python" /></>,
    links: [
      { label: 'Serve APIs', href: '/docs/embedded-runtime' },
      { label: 'MCP for agents', href: '/docs/mcp/overview' },
      { label: 'React hooks', href: '/docs/react/getting-started' },
    ],
  },
  {
    name: 'Cloud',
    pitch: 'Describe your business, and AI builds and hosts your analytics layer.',
    href: '/docs/cloud',
    badge: 'Waitlist',
    icon: <Cloud className="h-5 w-5 text-accent" strokeWidth={1.8} aria-hidden="true" />,
    links: [
      { label: 'AI authoring', href: '/docs/cloud/ai-authoring' },
      { label: 'Drafts and rollback', href: '/docs/cloud/releases' },
      { label: 'Hosted REST and MCP', href: '/docs/cloud/mcp' },
    ],
  },
];

/** One offering. On wider screens its three rows join the menu's shared grid, so separators line up across columns. */
function OfferingColumn({ offering }: { offering: Offering }) {
  return (
    <div className="rounded-lg p-1 max-sm:flex max-sm:flex-col sm:row-span-3 sm:grid sm:grid-rows-subgrid sm:gap-0">
      <Popover.Close asChild>
        <Link href={offering.href} className="group rounded-lg p-3 transition hover:bg-bg-alt focus-visible:bg-bg-alt focus-visible:outline-none">
          <span className="flex h-10 w-10 items-center justify-center gap-1 rounded-lg border border-border bg-bg-alt/70">{offering.icon}</span>
          <span className="mt-3 flex items-center gap-2 text-sm font-semibold text-text">
            {offering.name}
            {offering.badge && <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">{offering.badge}</span>}
          </span>
          <span className="mt-1 block text-xs leading-5 text-text-muted">{offering.pitch}</span>
        </Link>
      </Popover.Close>
      <div className="mx-3 mb-1 mt-1 border-t border-border" />
      <div className="flex flex-col">
        {offering.links.map((link) => (
          <Popover.Close key={link.href} asChild>
            <Link href={link.href} className="rounded-md px-3 py-1.5 text-[13px] text-text-muted transition hover:bg-bg-alt hover:text-text focus-visible:bg-bg-alt focus-visible:outline-none">
              {link.label}
            </Link>
          </Popover.Close>
        ))}
      </div>
    </div>
  );
}

export function ProductMenu() {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="group inline-flex min-h-9 items-center gap-1.5 text-[13.5px] font-medium text-text-muted transition hover:text-text data-[state=open]:text-text">
          Product <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180" aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={10} className="z-[60] max-h-[calc(100vh-80px)] w-[min(760px,calc(100vw-24px))] overflow-y-auto rounded-xl border border-border-strong bg-bg-card p-2 text-text shadow-xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out">
          <div className="grid gap-1 sm:grid-cols-3 sm:grid-rows-[auto_auto_auto] sm:divide-x sm:divide-border">
            {OFFERINGS.map((offering) => <OfferingColumn key={offering.name} offering={offering} />)}
          </div>
          <div className="mx-3 my-1 border-t border-border" />
          <div className="flex justify-end px-1 pb-1">
            <Popover.Close asChild>
              <Link href="/docs" className="shrink-0 rounded-lg px-3 py-2.5 text-xs font-semibold text-accent transition hover:bg-bg-alt focus-visible:bg-bg-alt focus-visible:outline-none">View all docs <span aria-hidden="true">→</span></Link>
            </Popover.Close>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
