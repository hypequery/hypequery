import { NextResponse, type NextRequest } from 'next/server';
import { wantsMarkdown } from '@/lib/markdown-negotiation';
import { twinFor } from '@/lib/markdown-twin';

/**
 * Markdown twins for agents.
 *
 * Every page under MD_ROOTS (lib/markdown-twin.ts) has a Markdown copy served by the
 * `/llms.mdx/...` route handlers. A request gets the Markdown when it asks
 * for it in any of three ways: a `.md` suffix, `Accept: text/markdown`, or a
 * known agent / HTTP-library user agent that is not a real browser (see
 * lib/markdown-negotiation.ts). HTML and Markdown carry the same
 * content and the HTML URL stays canonical, so this is not cloaking.
 * Everything else passes through with a `Link` header pointing at /llms.txt,
 * including the static pages listed as having no twin (lib/markdown-twin.ts).
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
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
  matcher: ['/', '/examples/:path*', '/recipes/:path*', '/guides/:path*', '/blog/:path*', '/docs/:path*', '/compare/:path*'],
};
