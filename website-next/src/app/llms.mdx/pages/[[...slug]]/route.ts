import { htmlToMarkdown } from '@/lib/html-to-markdown';
import { markdownNotFound, markdownResponse } from '@/lib/examples-markdown';
import { HTML_TWIN_PAGES } from '@/lib/markdown-twin';
import { absoluteUrl } from '@/lib/site';

/**
 * Markdown twins of hand-built pages (src/lib/markdown-twin.ts), converted from
 * the page's own rendered HTML so the two cannot drift. The page is fetched
 * from this deployment at request time and the result is cached at the CDN.
 * The fetch asks for HTML with a non-agent user agent, so src/proxy.ts passes
 * it through instead of rewriting it back here.
 */
export const dynamic = 'force-dynamic';

const TWIN_FETCH_USER_AGENT = 'hypequery-markdown-twin/1.0';

export async function GET(request: Request, { params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  const pathname = slug && slug.length > 0 ? `/${slug.join('/')}` : '/';
  if (!HTML_TWIN_PAGES.has(pathname)) return markdownNotFound(pathname);

  const origin = new URL(request.url).origin;
  const res = await fetch(new URL(pathname, origin), {
    headers: { Accept: 'text/html', 'User-Agent': TWIN_FETCH_USER_AGENT },
    cache: 'no-store',
    redirect: 'manual',
  });
  if (!res.ok) return markdownNotFound(pathname);

  const url = absoluteUrl(pathname);
  const page = htmlToMarkdown(await res.text(), url);
  const lines = [
    `[hypequery](${absoluteUrl('/').toString()}) › ${page.title ?? pathname}`,
    `Index for agents: ${absoluteUrl('/llms.txt').toString()}`,
    `Canonical page: ${url.toString()}`,
    '',
    ...(page.description ? [`> ${page.description}`, ''] : []),
    page.markdown,
    '',
  ];

  const response = markdownResponse(lines.join('\n'));
  // Rendered once per deploy at the edge; a new deployment starts a fresh cache.
  response.headers.set('Cache-Control', 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800');
  return response;
}
