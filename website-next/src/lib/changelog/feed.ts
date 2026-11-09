// Builds the RSS 2.0 document served at /changelog/rss.xml.

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import { commitUrl, sectionLabel } from './display';
import type { ChangelogSection } from './parse';

export interface FeedRelease {
  title: string;
  url: string;
  publishedAt?: string;
  category: string;
  sections: readonly ChangelogSection[];
}

export interface FeedChannel {
  title: string;
  description: string;
  siteUrl: string;
  feedUrl: string;
}

// Raw HTML in the markdown is dropped (no `allowDangerousHtml`), so the feed
// only carries what the markdown itself describes.
const markdownProcessor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype).use(rehypeStringify);

export function markdownToHtml(markdown: string): string {
  return String(markdownProcessor.processSync(markdown));
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Wraps text in CDATA, splitting any `]]>` it contains so the section stays closed. */
function cdata(value: string): string {
  return `<![CDATA[${value.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}

function toRfc822(isoDate?: string): string | undefined {
  const parsed = isoDate ? new Date(isoDate) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toUTCString() : undefined;
}

export function releaseHtml(sections: readonly ChangelogSection[]): string {
  return sections
    .map((section) => {
      const heading = section.title ? `<h3>${escapeXml(sectionLabel(section.title))}</h3>` : '';
      const items = section.changes
        .map((change) => {
          const commit = change.commit ? ` <a href="${commitUrl(change.commit)}"><code>${change.commit}</code></a>` : '';
          return `<li>${markdownToHtml(change.markdown)}${commit}</li>`;
        })
        .join('');
      return `${heading}<ul>${items}</ul>`;
    })
    .join('');
}

export function buildChangelogFeed(channel: FeedChannel, releases: readonly FeedRelease[]): string {
  const lastBuild = toRfc822(releases[0]?.publishedAt) ?? new Date().toUTCString();

  const items = releases.map((release) => {
    const pubDate = toRfc822(release.publishedAt);
    return [
      '    <item>',
      `      <title>${escapeXml(release.title)}</title>`,
      `      <link>${escapeXml(release.url)}</link>`,
      `      <guid isPermaLink="true">${escapeXml(release.url)}</guid>`,
      pubDate ? `      <pubDate>${pubDate}</pubDate>` : null,
      `      <category>${escapeXml(release.category)}</category>`,
      `      <description>${cdata(releaseHtml(release.sections))}</description>`,
      '    </item>',
    ]
      .filter(Boolean)
      .join('\n');
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    `    <title>${escapeXml(channel.title)}</title>`,
    `    <link>${escapeXml(channel.siteUrl)}</link>`,
    `    <description>${escapeXml(channel.description)}</description>`,
    '    <language>en</language>',
    `    <lastBuildDate>${lastBuild}</lastBuildDate>`,
    `    <atom:link href="${escapeXml(channel.feedUrl)}" rel="self" type="application/rss+xml" />`,
    ...items,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');
}
