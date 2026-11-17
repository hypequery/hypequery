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
 * route (compare articles only) would 404 on, and the section hubs. `/docs` is
 * a hand-built page too: the fumadocs source has no index page for it.
 */
export const HTML_TWIN_PAGES: ReadonlySet<string> = new Set<string>([
  ...marketingPages,
  ...embeddedAnalyticsComparePages.map((page) => page.href),
  '/docs',
  '/blog',
  '/compare',
  '/examples',
  '/recipes',
  '/guides',
]);

/**
 * The HTML page a Markdown request belongs to: `/docs/x.md` and `/docs/x.mdx`
 * are `/docs/x`, `/index.md` is `/`. It is the twin's canonical URL.
 */
export function htmlPathFor(pathname: string): string {
  // `.md` is the twin suffix; `.mdx` is what the docs pages link for their
  // own Markdown copy (next.config rewrites it for browsers, this covers agents).
  // The homepage's suffixed form is /index.md.
  const stripped = pathname.replace(/\.mdx?$/, '');
  return stripped === '/index' || stripped === '' ? '/' : stripped.replace(/(.)\/$/, '$1');
}

/** The public `.md` URL path of a page's Markdown twin: `/docs/x` is `/docs/x.md`, `/` is `/index.md`. */
export function markdownPathFor(pathname: string): string {
  const clean = htmlPathFor(pathname);
  return clean === '/' ? '/index.md' : `${clean}.md`;
}

/**
 * Sections whose pages get their `<link rel="alternate" type="text/markdown">`
 * from the root layout (components/MarkdownAlternate). Docs, recipes, guides and
 * examples pages declare their own in `generateMetadata`, so they are left out
 * to avoid a duplicate tag.
 */
export const LAYOUT_ALTERNATE_ROOTS: readonly string[] = ['/blog', '/compare'];

/** The `/llms.mdx/...` path that serves `pathname` as Markdown, or null when there is none. */
export function twinFor(pathname: string): string | null {
  if (pathname.endsWith('/llms.txt')) return null; // sub-indexes are already text
  const clean = htmlPathFor(pathname);
  if (HTML_TWIN_PAGES.has(clean)) return clean === '/' ? HTML_TWIN_ROOT : `${HTML_TWIN_ROOT}${clean}`;
  for (const [root, target] of Object.entries(MD_ROOTS)) {
    if (clean.startsWith(`${root}/`)) return `${target}${clean.slice(root.length)}`;
  }
  return null;
}
