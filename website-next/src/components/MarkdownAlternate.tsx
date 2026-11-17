'use client';

import { usePathname } from 'next/navigation';

/**
 * `<link rel="alternate" type="text/markdown">` for pages whose Markdown twin is
 * not already declared in their own metadata: hand-built pages and the blog and
 * compare sections (see LAYOUT_ALTERNATE_ROOTS in lib/markdown-twin.ts). React
 * hoists the `<link>` into `<head>`, and it is in the server-rendered HTML.
 *
 * The page list comes from the root layout as props so the data modules behind
 * it stay out of the client bundle.
 */
export function MarkdownAlternate({ pages, roots, origin }: { pages: readonly string[]; roots: readonly string[]; origin: string }) {
  const raw = usePathname() ?? '/';
  const pathname = raw === '/' ? raw : raw.replace(/\/$/, '');
  const hasTwin = pages.includes(pathname) || roots.some((root) => pathname.startsWith(`${root}/`));
  if (!hasTwin) return null;

  const markdownPath = pathname === '/' ? '/index.md' : `${pathname}.md`;
  return <link rel="alternate" type="text/markdown" href={`${origin}${markdownPath}`} />;
}
