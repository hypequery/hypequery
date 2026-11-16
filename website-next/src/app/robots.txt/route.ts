import { siteUrl } from '@/lib/site';

export const dynamic = 'force-static';

const disallow = ['/api/', '/cms/'];

/**
 * AI answer-engine and training crawlers, named so the policy is explicit
 * rather than inherited from `*`. A crawler that matches a named group ignores
 * the `*` group, so each group repeats the same rules.
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

/**
 * Usage preferences, in both current vocabularies:
 * - Content-Signal (https://contentsignals.org/): ai-train, search, ai-input.
 * - Content-Usage (IETF AIPREF, draft-ietf-aipref-attach / -vocab): train-ai, ai-use, search.
 * Neither binds a crawler. hypequery is open source and wants to be cited and
 * learned from, so every use is allowed.
 */
const preferences = ['Content-Signal: ai-train=yes, search=yes, ai-input=yes', 'Content-Usage: train-ai=y, ai-use=y, search=y'];

// Next's MetadataRoute.Robots cannot emit custom directives, so robots.txt is served as plain text.
function group(userAgents: string[]): string[] {
  return [
    ...userAgents.map((ua) => `User-Agent: ${ua}`),
    ...preferences,
    // Allow the LLM-oriented routes (/llms.txt, /llms-full.txt, /llms.mdx/*) so
    // agents can fetch clean Markdown. The per-page Markdown route still sends
    // `X-Robots-Tag: noindex` to keep it out of search results.
    'Allow: /',
    ...disallow.map((path) => `Disallow: ${path}`),
  ];
}

export function GET() {
  const body = [
    ...group(['*']),
    '',
    ...group(aiCrawlers),
    '',
    `Host: ${siteUrl.toString()}`,
    `Sitemap: ${new URL('/sitemap.xml', siteUrl).toString()}`,
    '',
  ].join('\n');

  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
