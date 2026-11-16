import { NextResponse, type NextRequest } from 'next/server';
import { wantsMarkdown } from '@/lib/markdown-negotiation';
import { htmlPathFor, twinFor } from '@/lib/markdown-twin';
import { siteUrl } from '@/lib/site';

/**
 * Markdown twins for agents.
 *
 * Every page under MD_ROOTS, and every hand-built page in HTML_TWIN_PAGES
 * (lib/markdown-twin.ts), has a Markdown copy served by the `/llms.mdx/...`
 * route handlers. A request gets the Markdown when it asks
 * for it in any of three ways: a `.md` suffix, `Accept: text/markdown`, or a
 * known agent / HTTP-library user agent that is not a real browser (see
 * lib/markdown-negotiation.ts). HTML and Markdown carry the same
 * content and the HTML URL stays canonical, so this is not cloaking.
 * Everything else passes through with a `Link` header pointing at /llms.txt.
 */
// Files with an extension other than the twin suffixes (.png, .xml, llms.txt, ...).
const STATIC_FILE = /\.(?!mdx?$)[a-z0-9]+$/i;

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (STATIC_FILE.test(pathname)) return NextResponse.next();
  const twin = twinFor(pathname);
  const markdown = wantsMarkdown({
    pathname,
    accept: request.headers.get('accept'),
    userAgent: request.headers.get('user-agent'),
    secFetchMode: request.headers.get('sec-fetch-mode'),
  });

  if (twin && markdown) {
    const url = request.nextUrl.clone();
    url.pathname = twin;
    const response = NextResponse.rewrite(url);
    response.headers.set('Vary', 'Accept, User-Agent');
    // The HTML page is the canonical version of every twin.
    const canonical = new URL(htmlPathFor(pathname), siteUrl).toString();
    response.headers.set('Link', `<${canonical}>; rel="canonical", </llms.txt>; rel="llms-txt"`);
    // Only the suffixed URLs (/docs/x.md, /docs/x.mdx) are separate documents to keep
    // out of search. A twin negotiated at the page's own URL (AI search crawlers such
    // as OAI-SearchBot and Claude-SearchBot get one by user agent) must not say
    // noindex: that would ask those engines to drop the real page.
    if (pathname !== htmlPathFor(pathname)) response.headers.set('X-Robots-Tag', 'noindex, nofollow');
    return response;
  }

  const response = NextResponse.next();
  response.headers.set('Link', '</llms.txt>; rel="llms-txt"');
  if (twin) response.headers.set('Vary', 'Accept, User-Agent');
  return response;
}

export const config = {
  // Every route except Next internals, API routes and the twins themselves.
  // Static files are skipped in the function body.
  matcher: ['/((?!_next/|api/|llms\\.mdx/).*)'],
};
