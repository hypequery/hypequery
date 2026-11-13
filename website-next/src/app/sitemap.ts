import type { MetadataRoute } from 'next';
import { getPosts } from '@/lib/blog';
import { source } from '@/lib/meta';
import { absoluteUrl } from '@/lib/site';
import { clickhouseFunctions, functionPathSegment, indexedFunctionSlugs } from '@/data/clickhouse-functions';
import { comparePages } from '@/data/compare-pages';
import { embeddedAnalyticsComparePages } from '@/data/embedded-analytics-compare';
import { semanticLayerPages } from '@/data/semantic-layer-pages';
import { entryHref, registryEntries } from '@/lib/examples';
import { retiredBlogSlugs } from '@/data/retired-blog-posts';
import { CHANGELOG_PACKAGES } from '@/lib/changelog/packages';
import { getCompareArticle } from '@/lib/compare-article';
import { maybeUpdatedFor } from '@/data/page-dates';

const redirectedBlogSlugs = new Set<string>([...comparePages.map((page) => page.slug), ...retiredBlogSlugs]);

// Pages marked noindex (/clickhouse-express, -hono, -trpc, -graphql) stay out of the sitemap.
const staticRoutes = [
  '/clickhouse',
  '/clickhouse/functions',
  '/embedded-analytics',
  ...semanticLayerPages.map((page) => page.href),
  '/',
  '/blog',
  '/changelog',
  ...CHANGELOG_PACKAGES.map((pkg) => `/changelog/${pkg.slug}`),
  '/compare',
  '/examples',
  '/recipes',
  '/guides',
  '/clickhouse-js',
  '/clickhouse-nodejs',
  '/clickhouse-dashboard',
  '/clickhouse-product-analytics',
  '/clickhouse-real-time-analytics',
  '/clickhouse-api',
  '/clickhouse-audit-log',
  '/clickhouse-time-series',
  '/clickhouse-semantic-layer',
  '/clickhouse-orm',
  '/clickhouse-openapi',
  '/clickhouse-saas-analytics',
  '/clickhouse-schema',
  '/clickhouse-typescript',
  '/clickhouse-python',
  '/clickhouse-python-analytics',
  '/clickhouse-fastapi',
  '/python-semantic-layer',
  '/clickhouse-python-multi-tenant',
  '/clickhouse-python-mcp',
  '/fastapi-react-analytics',
  '/clickhouse-django',
  '/clickhouse-flask',
  '/clickhouse-pandas',
  '/clickhouse-sqlalchemy',
  '/clickhouse-query-builder',
  '/type-safe-sql-typescript',
  '/clickhouse-mcp',
  '/clickhouse-react',
  '/clickhouse-nextjs',
  '/clickhouse-analytics',
  '/clickhouse-multi-tenant-analytics',
  '/use-cases',
  '/use-cases/internal-product-apis',
  '/use-cases/multi-tenant-saas',
  '/contact-us',
  '/tinybird-alternative',
  // Embedded analytics comparison pages. Static routes under /compare, not compare-pages.ts entries.
  ...embeddedAnalyticsComparePages.map((page) => page.href),
];

/** The date a compare page shows: its update when newer than the publish date, else the publish date. */
async function compareLastModified(slug: string): Promise<Date | undefined> {
  const article = await getCompareArticle(slug);
  const updated = article?.updated?.slice(0, 10);
  const published = article?.date?.slice(0, 10);
  const date = updated && (!published || updated > published) ? updated : published;
  return date ? new Date(date) : undefined;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [posts, docParams] = await Promise.all([
    getPosts(),
    Promise.resolve(source.generateParams()),
  ]);

  const staticEntries: MetadataRoute.Sitemap = staticRoutes.map((route) => {
    const updated = maybeUpdatedFor(route);
    return { url: absoluteUrl(route).toString(), lastModified: updated ? new Date(updated) : undefined };
  });

  const compareEntries: MetadataRoute.Sitemap = await Promise.all(
    comparePages.map(async (page) => ({
      url: absoluteUrl(page.href).toString(),
      lastModified: await compareLastModified(page.slug),
    })),
  );

  const docsEntries: MetadataRoute.Sitemap = docParams.map((params) => {
    const slug = Array.isArray(params.slug) ? params.slug : [];
    const path = slug.length > 0 ? `/docs/${slug.join('/')}` : '/docs';

    return {
      url: absoluteUrl(path).toString(),
    };
  });

  const blogEntries: MetadataRoute.Sitemap = posts
    .filter((post) => !redirectedBlogSlugs.has(post.slug))
    .map((post) => ({
      url: absoluteUrl(`/blog/${post.slug}`).toString(),
      lastModified: post.data.date ? new Date(post.data.date) : undefined,
    }));

  const functionEntries: MetadataRoute.Sitemap = clickhouseFunctions
    .filter((fn) => indexedFunctionSlugs.has(fn.slug))
    .map((fn) => ({
      url: absoluteUrl(`/clickhouse/functions/${functionPathSegment(fn.name)}`).toString(),
      lastModified: fn.updated ? new Date(fn.updated) : undefined,
    }));

  const exampleEntries: MetadataRoute.Sitemap = registryEntries.map((entry) => ({
    url: absoluteUrl(entryHref(entry)).toString(),
  }));

  return [...staticEntries, ...compareEntries, ...functionEntries, ...exampleEntries, ...docsEntries, ...blogEntries];
}
