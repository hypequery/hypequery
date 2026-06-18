import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        // Allow the LLM-oriented routes (/llms.txt, /llms-full.txt, /llms.mdx/*)
        // so agents can fetch clean Markdown. The per-page Markdown route still
        // sends `X-Robots-Tag: noindex` to keep it out of search results.
        allow: '/',
        disallow: ['/api/', '/cms/'],
      },
    ],
    sitemap: new URL('/sitemap.xml', siteUrl).toString(),
    host: siteUrl.toString(),
  };
}
