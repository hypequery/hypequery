import type { MetadataRoute } from 'next';
import { getPosts } from '@/lib/blog';
import { source } from '@/lib/meta';
import { absoluteUrl } from '@/lib/site';

const redirectedBlogSlugs = new Set([
  'hypequery-vs-clickhouse-client',
  'hypequery-vs-kysely',
]);

const staticRoutes = [
  '/',
  '/blog',
  '/compare',
  '/clickhouse-typescript',
  '/clickhouse-query-builder',
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

  return [...staticEntries, ...docsEntries, ...blogEntries];
}
