import type { MetadataRoute } from 'next';
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { source } from '@/lib/meta';
import { getCanonicalUrl } from '@/lib/seo';
import { blogTopics } from '@/lib/blog-topics';

function getSeedBlogRoutes() {
  const blogDir = path.join(process.cwd(), 'content/blog');

  if (!fs.existsSync(blogDir)) {
    return [];
  }

  return fs
    .readdirSync(blogDir)
    .filter((file) => file.endsWith('.md') || file.endsWith('.mdx'))
    .map((file) => {
      const filePath = path.join(blogDir, file);
      const fileContents = fs.readFileSync(filePath, 'utf8');
      const { data } = matter(fileContents);
      const explicitSlug = typeof data.slug === 'string' ? data.slug : null;
      const filenameSlug = file
        .replace(/^\d{4}-\d{2}-\d{2}-/, '')
        .replace(/\.(md|mdx)$/, '');
      const slug = (explicitSlug ?? filenameSlug)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

      return `/blog/${slug}`;
    });
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes = ['/', '/blog', '/blog/topics', '/docs', '/use-cases', '/use-cases/internal-product-apis', '/use-cases/multi-tenant-saas'];
  const docsRoutes = source.generateParams().map(({ slug }) => `/docs/${slug.join('/')}`);
  const blogRoutes = getSeedBlogRoutes();
  const topicRoutes = blogTopics.map((topic) => `/blog/topics/${topic.slug}`);

  return [...staticRoutes, ...docsRoutes, ...blogRoutes, ...topicRoutes].map((pathname) => ({
    url: getCanonicalUrl(pathname).toString(),
    changeFrequency: pathname.startsWith('/blog/') ? 'monthly' : 'weekly',
    priority: pathname === '/' ? 1 : pathname.startsWith('/docs/') ? 0.8 : 0.7,
  }));
}
