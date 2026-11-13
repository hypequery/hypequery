import { embeddedAnalyticsComparePages } from '@/data/embedded-analytics-compare';

/** Site root -> llms.mdx root that serves its Markdown twins. */
export const MD_ROOTS: Record<string, string> = {
  '/examples': '/llms.mdx/examples',
  '/recipes': '/llms.mdx/recipes',
  '/guides': '/llms.mdx/guides',
  '/blog': '/llms.mdx/blog',
  '/docs': '/llms.mdx/docs',
  '/compare': '/llms.mdx/compare',
};

/**
 * Pages under a twin root that are hand-built static routes with no Markdown
 * twin. Rewriting an agent to `/llms.mdx/...` for these would 404, so agents
 * get the server-rendered HTML instead.
 */
const NO_TWIN = new Set<string>(embeddedAnalyticsComparePages.map((page) => page.href));

/** The `/llms.mdx/...` path that serves `pathname` as Markdown, or null when there is none. */
export function twinFor(pathname: string): string | null {
  if (pathname.endsWith('/llms.txt')) return null; // sub-indexes are already text
  // `.md` is the twin suffix; `.mdx` is what the docs pages link for their
  // own Markdown copy (next.config rewrites it for browsers, this covers agents).
  const clean = pathname.replace(/\.mdx?$/, '');
  if (NO_TWIN.has(clean)) return null;
  for (const [root, target] of Object.entries(MD_ROOTS)) {
    if (clean === root) return null; // hubs have no twin; /llms.txt indexes them
    if (clean.startsWith(`${root}/`)) return `${target}${clean.slice(root.length)}`;
  }
  return null;
}
