import type { MetadataRoute } from 'next';
import { getPosts } from '@/lib/blog';
import { source } from '@/lib/meta';
import { absoluteUrl } from '@/lib/site';
import { clickhouseFunctions, functionPathSegment } from '@/data/clickhouse-functions';

const redirectedBlogSlugs = new Set([
  'hypequery-vs-clickhouse-client',
  'hypequery-vs-kysely',
  'hypequery-vs-drizzle',
  'hypequery-vs-prisma',
  'hypequery-vs-cube',
  'hypequery-vs-tinybird',
]);

const staticRoutes = [
  '/clickhouse/functions',
  '/',
  '/blog',
  '/compare',
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
  '/clickhouse-rest-api',
  '/clickhouse-openapi',
  '/clickhouse-saas-analytics',
  '/clickhouse-schema',
  '/clickhouse-typescript',
  '/clickhouse-query-builder',
  '/drizzle-clickhouse',
  '/prisma-clickhouse',
  '/typeorm-clickhouse',
  '/clickhouse-mcp',
  '/clickhouse-react',
  '/clickhouse-nextjs',
  '/clickhouse-analytics',
  '/clickhouse-multi-tenant-analytics',
  '/docs/introduction',
  '/docs/quick-start',
  '/use-cases',
  '/use-cases/internal-product-apis',
  '/use-cases/multi-tenant-saas',
  '/compare/hypequery-vs-clickhouse-client',
  '/compare/hypequery-vs-kysely',
  '/compare/hypequery-vs-drizzle',
  '/compare/hypequery-vs-prisma',
  '/compare/hypequery-vs-cube',
  '/compare/hypequery-vs-tinybird',
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [posts, docParams] = await Promise.all([
    getPosts(),
    Promise.resolve(source.generateParams()),
  ]);

  const staticEntries: MetadataRoute.Sitemap = staticRoutes.map((route) => ({
    url: absoluteUrl(route).toString(),
  }));

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

  const functionEntries: MetadataRoute.Sitemap = clickhouseFunctions.map((fn) => ({
    url: absoluteUrl(`/clickhouse/functions/${functionPathSegment(fn.name)}`).toString(),
  }));

  return [...staticEntries, ...functionEntries, ...docsEntries, ...blogEntries];
}
