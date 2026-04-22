import type { MetadataRoute } from 'next';
import { getPosts } from '@/lib/blog';
import { source } from '@/lib/meta';
import { absoluteUrl } from '@/lib/site';

const staticRoutes = ['/', '/blog', '/clickhouse-typescript', '/docs/introduction', '/docs/quick-start', '/use-cases'];

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

  const blogEntries: MetadataRoute.Sitemap = posts.map((post) => ({
    url: absoluteUrl(`/blog/${post.slug}`).toString(),
    lastModified: post.data.date ? new Date(post.data.date) : undefined,
  }));

  return [...staticEntries, ...docsEntries, ...blogEntries];
}
