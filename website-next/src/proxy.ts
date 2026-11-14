import { NextResponse, type NextRequest } from 'next/server';
import { wantsMarkdown } from '@/lib/markdown-negotiation';
import { twinFor } from '@/lib/markdown-twin';

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
    response.headers.set('Link', '</llms.txt>; rel="llms-txt"');
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
