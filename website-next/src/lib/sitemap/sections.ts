import type { MetadataRoute } from 'next';
import { getPosts } from '@/lib/blog';
import { source } from '@/lib/meta';
import { absoluteUrl } from '@/lib/site';
import { clickhouseFunctions, functionPathSegment, indexedFunctionSlugs } from '@/data/clickhouse-functions';
import { comparePages } from '@/data/compare-pages';
import { embeddedAnalyticsComparePages } from '@/data/embedded-analytics-compare';
import { marketingPages } from '@/data/marketing-pages';
import { entryHref, registryEntries } from '@/lib/examples';
import { retiredBlogSlugs } from '@/data/retired-blog-posts';
import { CHANGELOG_PACKAGES } from '@/lib/changelog/packages';
import { getCompareArticle } from '@/lib/compare-article';
import { maybeUpdatedFor } from '@/data/page-dates';

/**
 * One child sitemap per page type. `/sitemap.xml` is the index
 * (src/app/sitemap.xml/route.ts); each id below is served at `/sitemap/<id>.xml` (src/app/sitemap/[file]/route.ts).(src/app/sitemap/[file]/route.ts).
 */
export const SITEMAP_SECTIONS = ['pages', 'docs', 'blog', 'compare', 'examples', 'functions', 'changelog'] as const;
export type SitemapSection = (typeof SITEMAP_SECTIONS)[number];

export function isSitemapSection(id: string): id is SitemapSection {
  return (SITEMAP_SECTIONS as readonly string[]).includes(id);
}

const redirectedBlogSlugs = new Set<string>([...comparePages.map((page) => page.slug), ...retiredBlogSlugs]);

/** A hand-built page, dated from src/data/page-dates.ts when it is tracked there. */
function staticEntry(route: string): MetadataRoute.Sitemap[number] {
  const updated = maybeUpdatedFor(route);
  return { url: absoluteUrl(route).toString(), lastModified: updated ? new Date(updated) : undefined };
}

/** The date a compare page shows: its update when newer than the publish date, else the publish date. */
async function compareLastModified(slug: string): Promise<Date | undefined> {
  const article = await getCompareArticle(slug);
  const updated = article?.updated?.slice(0, 10);
  const published = article?.date?.slice(0, 10);
  const date = updated && (!published || updated > published) ? updated : published;
  return date ? new Date(date) : undefined;
}

async function blogEntries(): Promise<MetadataRoute.Sitemap> {
  const posts = (await getPosts()).filter((post) => !redirectedBlogSlugs.has(post.slug));
  const entries = posts.map((post) => ({
    url: absoluteUrl(`/blog/${post.slug}`).toString(),
    lastModified: post.data.date ? new Date(post.data.date) : undefined,
  }));
  // The hub changes whenever a post is published.
  return [{ url: absoluteUrl('/blog').toString(), lastModified: latest(entries) }, ...entries];
}

async function compareEntries(): Promise<MetadataRoute.Sitemap> {
  const articles = await Promise.all(
    comparePages.map(async (page) => ({ url: absoluteUrl(page.href).toString(), lastModified: await compareLastModified(page.slug) })),
  );
  const entries = [...articles, ...embeddedAnalyticsComparePages.map((page) => staticEntry(page.href))];
  return [{ url: absoluteUrl('/compare').toString(), lastModified: latest(entries) }, ...entries];
}

function docsEntries(): MetadataRoute.Sitemap {
  return source.generateParams().map((params) => {
    const slug = Array.isArray(params.slug) ? params.slug : [];
    return { url: absoluteUrl(slug.length > 0 ? `/docs/${slug.join('/')}` : '/docs').toString() };
  });
}

function functionEntries(): MetadataRoute.Sitemap {
  const entries = clickhouseFunctions
    .filter((fn) => indexedFunctionSlugs.has(fn.slug))
    .map((fn) => ({
      url: absoluteUrl(`/clickhouse/functions/${functionPathSegment(fn.name)}`).toString(),
      lastModified: fn.updated ? new Date(fn.updated) : undefined,
    }));
  return [{ url: absoluteUrl('/clickhouse/functions').toString(), lastModified: latest(entries) }, ...entries];
}

function exampleEntries(): MetadataRoute.Sitemap {
  return [
    ...['/examples', '/recipes', '/guides'].map(staticEntry),
    ...registryEntries.map((entry) => ({ url: absoluteUrl(entryHref(entry)).toString() })),
  ];
}

function changelogEntries(): MetadataRoute.Sitemap {
  return ['/changelog', ...CHANGELOG_PACKAGES.map((pkg) => `/changelog/${pkg.slug}`)].map(staticEntry);
}

export async function sitemapSection(section: SitemapSection): Promise<MetadataRoute.Sitemap> {
  switch (section) {
    case 'pages':
      return marketingPages.map(staticEntry);
    case 'docs':
      return docsEntries();
    case 'blog':
      return blogEntries();
    case 'compare':
      return compareEntries();
    case 'examples':
      return exampleEntries();
    case 'functions':
      return functionEntries();
    case 'changelog':
      return changelogEntries();
  }
}

/** The newest `lastModified` in `entries`, or undefined when none is dated. */
export function latest(entries: MetadataRoute.Sitemap): Date | undefined {
  let max: Date | undefined;
  for (const entry of entries) {
    const date = entry.lastModified ? new Date(entry.lastModified) : undefined;
    if (date && !Number.isNaN(date.getTime()) && (!max || date > max)) max = date;
  }
  return max;
}
