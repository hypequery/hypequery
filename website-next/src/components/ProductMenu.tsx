'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { ChevronDown, Cloud, History, MessageSquare, Send, Server, Sparkles } from 'lucide-react';
import { SiModelcontextprotocol, SiPython, SiReact, SiTypescript } from 'react-icons/si';

const itemClassName = 'group flex items-start gap-3 rounded-lg p-3 transition hover:bg-bg-alt focus-visible:bg-bg-alt focus-visible:outline-none';
const iconClassName = 'flex h-10 w-10 shrink-0 items-center justify-center gap-1 rounded-lg border border-border bg-bg-alt/70';

type MenuItem = {
  title: string;
  description: string;
  icon: ReactNode;
  href?: string;
  badge?: string;
};

// The lead column: hypequery Cloud, the AI-first path the homepage leads with.
const CLOUD_ITEMS: MenuItem[] = [
  {
    title: 'AI authoring',
    description: 'Describe your business. Cloud drafts and publishes your semantic layer.',
    href: '/docs/cloud/ai-authoring',
    icon: <Sparkles className="h-5 w-5 text-accent" strokeWidth={1.8} aria-hidden="true" />,
  },
  {
    title: 'Cloud chat',
    description: 'Ask questions about your data and get charts, right in Cloud.',
    href: '/docs/cloud',
    icon: <MessageSquare className="h-5 w-5 text-accent" strokeWidth={1.8} aria-hidden="true" />,
  },
  {
    title: 'Drafts and rollback',
    description: 'Review every change before it ships. Roll back in one click.',
    href: '/docs/cloud/releases',
    icon: <History className="h-5 w-5 text-accent" strokeWidth={1.8} aria-hidden="true" />,
  },
  {
    title: 'Embedded chat',
    description: 'Let your customers ask questions about their data.',
    badge: 'Coming soon',
    icon: <Send className="h-4.5 w-4.5 text-text-muted" strokeWidth={1.8} aria-hidden="true" />,
  },
];

// The open-source path: build the analytics layer in your own codebase.
const OPEN_SOURCE_ITEMS: MenuItem[] = [
  {
    title: 'Datasets',
    description: 'Define measures, dimensions, and tenant rules in TypeScript or Python.',
    href: '/docs/datasets/overview',
    icon: <><SiTypescript className="h-4 w-4 text-[#3178c6]" aria-label="TypeScript" /><SiPython className="h-4 w-4 text-[#3776ab]" aria-label="Python" /></>,
  },
  {
    title: 'Serve APIs',
    description: 'Expose datasets as validated HTTP endpoints with OpenAPI.',
    href: '/docs/embedded-runtime',
    icon: <Server className="h-5 w-5 text-text" strokeWidth={1.8} aria-hidden="true" />,
  },
  {
    title: 'MCP for agents',
    description: 'Give Claude and other agents governed access to your datasets.',
    href: '/docs/mcp/overview',
    icon: <SiModelcontextprotocol className="h-5 w-5 text-text" aria-hidden="true" />,
  },
  {
    title: 'React hooks',
    description: 'Build dashboards with typed TanStack Query hooks.',
    href: '/docs/react/getting-started',
    icon: <SiReact className="h-5 w-5 text-[#339db6]" aria-hidden="true" />,
  },
];

function MenuEntry({ item }: { item: MenuItem }) {
  const content = (
    <>
      <span className={iconClassName}>{item.icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-sm font-semibold text-text">
          {item.title}
          {item.badge && <span className="rounded bg-bg-alt px-1.5 py-0.5 text-[10px] font-medium text-text-muted">{item.badge}</span>}
        </span>
        <span className="mt-0.5 block text-xs leading-5 text-text-muted">{item.description}</span>
      </span>
    </>
  );

  if (!item.href) {
    return <div className="flex items-start gap-3 rounded-lg p-3 opacity-70">{content}</div>;
  }

  return (
    <Popover.Close asChild>
      <Link href={item.href} className={itemClassName}>{content}</Link>
    </Popover.Close>
  );
}

function MenuColumn({ label, badge, items, className = '' }: { label: string; badge?: string; items: MenuItem[]; className?: string }) {
  return (
    <div className={`rounded-lg p-1 ${className}`}>
      <p className="flex items-center gap-2 px-3 pb-1 pt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-text-muted">
        {label}
        {badge && <span className="rounded bg-accent/10 px-1.5 py-0.5 font-sans text-[10px] font-medium normal-case tracking-normal text-accent">{badge}</span>}
      </p>
      {items.map((item) => <MenuEntry key={item.title} item={item} />)}
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
        <Popover.Content align="end" sideOffset={10} className="z-[60] max-h-[calc(100vh-80px)] w-[min(680px,calc(100vw-24px))] overflow-y-auto rounded-xl border border-border-strong bg-bg-card p-2 text-text shadow-xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out">
          <div className="grid gap-1 sm:grid-cols-2">
            <MenuColumn label="hypequery Cloud" badge="Waitlist" items={CLOUD_ITEMS} className="bg-accent/[0.04]" />
            <MenuColumn label="Open source" items={OPEN_SOURCE_ITEMS} />
          </div>
          <div className="mx-3 my-1 border-t border-border" />
          <div className="flex flex-wrap items-center gap-1 px-1 pb-1">
            <Popover.Close asChild>
              <Link href="/docs/query-building/basics" className="inline-flex items-center gap-2 rounded-lg px-3 py-2.5 text-xs font-medium text-text-muted transition hover:bg-bg-alt hover:text-text focus-visible:bg-bg-alt focus-visible:outline-none">
                <SiTypescript className="h-3.5 w-3.5 text-[#3178c6]" aria-hidden="true" />
                Query builder
              </Link>
            </Popover.Close>
            <span className="flex-1" />
            <Popover.Close asChild>
              <Link href="/docs/cloud" className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2.5 text-xs font-semibold text-text transition hover:bg-bg-alt focus-visible:bg-bg-alt focus-visible:outline-none">
                <Cloud className="h-3.5 w-3.5 text-accent" strokeWidth={1.8} aria-hidden="true" />
                Explore Cloud
              </Link>
            </Popover.Close>
            <Popover.Close asChild>
              <Link href="/docs" className="shrink-0 rounded-lg px-3 py-2.5 text-xs font-semibold text-accent transition hover:bg-bg-alt focus-visible:bg-bg-alt focus-visible:outline-none">View all docs <span aria-hidden="true">→</span></Link>
            </Popover.Close>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
