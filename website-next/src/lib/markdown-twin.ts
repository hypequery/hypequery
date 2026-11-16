import { embeddedAnalyticsComparePages } from '@/data/embedded-analytics-compare';
import { marketingPages } from '@/data/marketing-pages';

/** Site root -> llms.mdx root that serves its Markdown twins from content sources. */
export const MD_ROOTS: Record<string, string> = {
  '/examples': '/llms.mdx/examples',
  '/recipes': '/llms.mdx/recipes',
  '/guides': '/llms.mdx/guides',
  '/blog': '/llms.mdx/blog',
  '/docs': '/llms.mdx/docs',
  '/compare': '/llms.mdx/compare',
};

/** Where the Markdown twins of hand-built pages are served (src/app/llms.mdx/pages). */
export const HTML_TWIN_ROOT = '/llms.mdx/pages';

/**
 * Hand-built pages with no content source. Their twin is converted from the
 * page's own rendered HTML, so it cannot drift from what the page says. This
 * includes the static compare pages under /compare, which the /llms.mdx/compare
 * route (compare articles only) would 404 on, and the section hubs.
 */
export const HTML_TWIN_PAGES: ReadonlySet<string> = new Set<string>([
  ...marketingPages,
  ...embeddedAnalyticsComparePages.map((page) => page.href),
  '/blog',
  '/compare',
  '/examples',
  '/recipes',
  '/guides',
]);

/** The `/llms.mdx/...` path that serves `pathname` as Markdown, or null when there is none. */
export function twinFor(pathname: string): string | null {
  if (pathname.endsWith('/llms.txt')) return null; // sub-indexes are already text
  // `.md` is the twin suffix; `.mdx` is what the docs pages link for their
  // own Markdown copy (next.config rewrites it for browsers, this covers agents).
  // The homepage's suffixed form is /index.md.
  const stripped = pathname.replace(/\.mdx?$/, '');
  const clean = stripped === '/index' || stripped === '' ? '/' : stripped.replace(/(.)\/$/, '$1');
  if (HTML_TWIN_PAGES.has(clean)) return clean === '/' ? HTML_TWIN_ROOT : `${HTML_TWIN_ROOT}${clean}`;
  for (const [root, target] of Object.entries(MD_ROOTS)) {
    if (clean.startsWith(`${root}/`)) return `${target}${clean.slice(root.length)}`;
  }
  return null;
}
