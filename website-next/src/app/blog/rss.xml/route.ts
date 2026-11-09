import { getPosts } from '@/lib/blog';
import { absoluteUrl } from '@/lib/site';
import { comparePageBySlug } from '@/data/compare-pages';
import { retiredBlogSlugs } from '@/data/retired-blog-posts';
import { blogAuthorName } from '@/lib/blog-author';

// RSS 2.0 feed of published posts. Compare-page and retired-post slugs are
// redirects, so they are excluded exactly as the blog index excludes them.

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toRfc822(date?: string) {
  const parsed = date ? new Date(date) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toUTCString() : undefined;
}

export async function GET() {
  const posts = (await getPosts()).filter(
    (post) => !(post.slug in comparePageBySlug) && !retiredBlogSlugs.has(post.slug),
  );
  const channelUrl = absoluteUrl('/blog').toString();
  const feedUrl = absoluteUrl('/blog/rss.xml').toString();
  const lastBuild = toRfc822(posts[0]?.data.date) ?? new Date().toUTCString();

  const items = posts
    .map((post) => {
      const url = absoluteUrl(`/blog/${post.slug}`).toString();
      const pubDate = toRfc822(post.data.date);
      return [
        '    <item>',
        `      <title>${escapeXml(post.data.title)}</title>`,
        `      <link>${url}</link>`,
        `      <guid isPermaLink="true">${url}</guid>`,
        post.data.description ? `      <description>${escapeXml(post.data.description)}</description>` : null,
        pubDate ? `      <pubDate>${pubDate}</pubDate>` : null,
        `      <dc:creator>${escapeXml(blogAuthorName(post.data.author))}</dc:creator>`,
        ...(post.data.tags ?? []).map((tag) => `      <category>${escapeXml(tag)}</category>`),
        '    </item>',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    '  <channel>',
    '    <title>hypequery blog</title>',
    `    <link>${channelUrl}</link>`,
    '    <description>Implementation guides, comparisons, and release notes for ClickHouse teams building analytics in TypeScript and Python.</description>',
    '    <language>en</language>',
    `    <lastBuildDate>${lastBuild}</lastBuildDate>`,
    `    <atom:link href="${feedUrl}" rel="self" type="application/rss+xml" />`,
    items,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
