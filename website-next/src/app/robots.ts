import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/site';

const disallow = ['/api/', '/cms/'];

/**
 * AI answer-engine and training crawlers, named so the policy is explicit
 * rather than inherited from `*`. A crawler that matches a named group ignores
 * the `*` group, so each group repeats the same disallow list.
 */
const aiCrawlers = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-SearchBot',
  'Claude-User',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'Applebot-Extended',
  'CCBot',
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        // Allow the LLM-oriented routes (/llms.txt, /llms-full.txt, /llms.mdx/*)
        // so agents can fetch clean Markdown. The per-page Markdown route still
        // sends `X-Robots-Tag: noindex` to keep it out of search results.
        allow: '/',
        disallow,
      },
      { userAgent: aiCrawlers, allow: '/', disallow },
    ],
    sitemap: new URL('/sitemap.xml', siteUrl).toString(),
    host: siteUrl.toString(),
  };
}
