import Link from 'next/link';
import { Book, Braces } from 'lucide-react';
import type { DocsLayoutProps } from 'fumadocs-ui/layouts/docs';
import { standaloneTabUrls } from '@/lib/standalone-urls';

export function baseOptions(): Omit<DocsLayoutProps, 'tree' | 'children'> {
  return {
    links: [
      {
        type: 'main',
        text: 'Blog',
        url: '/blog',
        active: 'nested-url',
      },
      {
        type: 'main',
        text: 'Use Cases',
        url: '/use-cases',
        active: 'nested-url',
      },
    ],
    nav: {
      title: (
        <div className="px-3 font-mono text-lg font-bold text-indigo-300 flex items-center">
          &gt; hypequery
        </div>
      ),
      url: '/',
    },
    sidebar: {
      defaultOpenLevel: 1,
      banner: (
        <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
          <p className="font-semibold text-white">Start here</p>
          <div className="mt-2 flex flex-col gap-2">
            <Link href="/docs/quick-start" className="text-indigo-300 hover:text-indigo-200">
              Quick start
            </Link>
            <Link href="/docs/introduction" className="text-slate-300 hover:text-white">
              Introduction
            </Link>
          </div>
        </div>
      ),
      tabs: [
        {
          title: 'Documentation',
          description: 'Framework guide and getting started',
          url: '/docs',
          icon: <Book className="w-4 h-4 text-indigo-400" />,
        },
        {
          title: 'Standalone Query Builder',
          description: 'Build type safe queries with the ClickHouse client directly',
          url: '/docs/standalone-query-builder/when-to-use',
          icon: <Braces className="w-4 h-4 text-purple-500" />,
          urls: standaloneTabUrls,
        },
      ],
    },
  };
}
