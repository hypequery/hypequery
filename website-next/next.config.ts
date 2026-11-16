import type { NextConfig } from "next";
import { createMDX } from "fumadocs-mdx/next";
import { comparePages } from "./src/data/compare-pages";
import { retiredBlogPosts } from "./src/data/retired-blog-posts";

const withMDX = createMDX();

/**
 * Responses that are not pages: social-card images, feeds and the Markdown twins
 * served directly from /llms.mdx. They are kept out of Google's index with a header
 * rather than robots.txt, because Twitterbot obeys robots.txt and blocked card images
 * would stop rendering in shared links. /og sets the same header in its route.
 * Suffixed twins (/docs/x.md) get theirs, and a canonical Link, in src/proxy.ts.
 */
const noindexRoutes = [
  '/opengraph-image',
  '/blog/:slug/opengraph-image',
  '/blog/rss.xml',
  '/changelog/rss.xml',
  '/llms.mdx/:path*',
];

const nextConfig: NextConfig = {
  trailingSlash: false,
  turbopack: {
    root: __dirname,
  },
  async headers() {
    return noindexRoutes.map((source) => ({
      source,
      headers: [{ key: 'X-Robots-Tag', value: 'noindex' }],
    }));
  },
  async redirects() {
    return [
      // One host. Vercel's domain settings already send www to the apex; this keeps the 301 in code too,
      // so it survives a domain-config change. Search Console still had www URLs indexed from an old
      // www sitemap (last crawled August 2026).
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'www.hypequery.com' }],
        destination: 'https://hypequery.com/:path*',
        statusCode: 301,
      },
      // One page per topic (2026-11-15). PRs #965 and #967 proposed second pages for the same
      // searches; these redirects keep the published versions canonical even if those land later.
      { source: '/clickhouse-ai-sdk', destination: '/clickhouse-ai', permanent: true },
      { source: '/clickhouse-ai-agents', destination: '/clickhouse-ai', permanent: true },
      { source: '/semantic-layer/agentic-analytics', destination: '/blog/agentic-analytics', permanent: true },
      // every compare page also exists as a seed blog post; canonical home is /compare
      ...comparePages.map((page) => ({
        source: `/blog/${page.slug}`,
        destination: page.href,
        permanent: true,
      })),
      // Quick starts are organised by outcome, with TypeScript and Python tabs on
      // each page (November 2026). The Python quick start opens on its tab.
      {
        source: '/docs/python/quick-start',
        destination: '/docs/quick-start#python',
        permanent: true,
      },
      // Old addresses Google still crawls and gets a 404 for (Search Console,
      // November 2026). These come first so they win over the patterns below.
      // Seed posts used to be served at their dated filename.
      {
        source: '/blog/:date(\\d{4}-\\d{2}-\\d{2})-:slug([^/]+)',
        destination: '/blog/:slug',
        permanent: true,
      },
      {
        source: '/docs/legacy-serve/authentication',
        destination: '/docs/authentication',
        permanent: true,
      },
      {
        source: '/docs/legacy-serve/multi-tenancy',
        destination: '/docs/multi-tenancy',
        permanent: true,
      },
      {
        source: '/docs/legacy-serve/migration-builder-to-serve',
        destination: '/docs/datasets/serve-integration',
        permanent: true,
      },
      {
        source: '/docs/legacy-serve/:path*',
        destination: '/docs/reference/api/runtime',
        permanent: true,
      },
      {
        source: '/docs/migrate-legacy-serve-api',
        destination: '/docs/datasets/serve-integration',
        permanent: true,
      },
      {
        source: '/docs/serve',
        destination: '/docs/reference/api/runtime',
        permanent: true,
      },
      {
        source: '/docs/serve/overview',
        destination: '/docs/reference/api/runtime',
        permanent: true,
      },
      {
        source: '/docs/reference/cli',
        destination: '/docs/reference/api/cli',
        permanent: true,
      },
      {
        source: '/docs/reference/query',
        destination: '/docs/reference/api/query',
        permanent: true,
      },
      {
        source: '/docs/reference/runtime',
        destination: '/docs/reference/api/runtime',
        permanent: true,
      },
      {
        source: '/docs/query-building/generated-schema',
        destination: '/docs/schemas',
        permanent: true,
      },
      {
        source: '/docs/recipes/:slug(nextjs|fetch|nodejs|vite)',
        destination: '/docs/:slug',
        permanent: true,
      },
      {
        source: '/docs/queries/aggregations',
        destination: '/docs/query-building/aggregation',
        permanent: true,
      },
      {
        source: '/docs/queries/:slug',
        destination: '/docs/query-building/:slug',
        permanent: true,
      },
      {
        source: '/docs/getting-started/:slug',
        destination: '/docs/:slug',
        permanent: true,
      },
      {
        source: '/docs/functions/query-builder/distinct',
        destination: '/docs/query-building/aggregation',
        permanent: true,
      },
      {
        source: '/docs/standalone-query-builder',
        destination: '/docs/query-building/basics',
        permanent: true,
      },
      {
        source: '/docs/standalone-query-builder/:slug(when-to-use|setup|execution|query-building|standalone-query-builder)',
        destination: '/docs/query-building/basics',
        permanent: true,
      },
      {
        source: '/docs/standalone-query-builder/query-building/advanced',
        destination: '/docs/query-building/advanced-filtering',
        permanent: true,
      },
      // One page per search (Search Console, November 2026): each source covered
      // the same queries as its destination, which is the page Google ranks.
      { source: '/prisma-clickhouse', destination: '/clickhouse-orm', permanent: true },
      { source: '/typeorm-clickhouse', destination: '/clickhouse-orm', permanent: true },
      { source: '/drizzle-clickhouse', destination: '/compare/hypequery-vs-drizzle', permanent: true },
      { source: '/moosestack-alternative', destination: '/compare/hypequery-vs-moose', permanent: true },
      // Never pages. Google resolved `import { Users } from './datasets/users'` in the
      // core-concepts code sample against /docs/core-concepts (404, November 2026).
      { source: '/docs/datasets/users', destination: '/docs/datasets/defining-datasets', permanent: true },
      { source: '/docs/datasets', destination: '/docs/datasets/overview', permanent: true },
      // Removed blog posts, merged into another page (src/data/retired-blog-posts.ts).
      ...retiredBlogPosts.map((post) => ({
        source: `/blog/${post.slug}`,
        destination: post.destination,
        permanent: true,
      })),
      {
        source: '/clickhouse-rest-api',
        destination: '/clickhouse-api',
        permanent: true,
      },
      {
        source: '/docs/python-client-workflow',
        destination: '/docs/python/client-endpoints',
        permanent: true,
      },
      {
        source: '/docs/react/cloud',
        destination: '/docs/cloud/react',
        permanent: true,
      },
      {
        source: '/docs/roadmap',
        destination: '/changelog',
        permanent: true,
      },
      {
        source: '/docs/installation',
        destination: '/docs/quick-start',
        permanent: true,
      },
      {
        source: '/docs/quick-start-builder',
        destination: '/docs/query-building/basics',
        permanent: true,
      },
      {
        source: '/docs/manual-installation',
        destination: '/docs/quick-start',
        permanent: true,
      },
      {
        source: '/docs/type-generation',
        destination: '/docs/schemas',
        permanent: true,
      },
      {
        source: '/docs/guides/query-building',
        destination: '/docs/query-building/basics',
        permanent: true,
      },
      {
        source: '/docs/guides/filtering',
        destination: '/docs/query-building/where',
        permanent: true,
      },
      {
        source: '/docs/reference/api',
        destination: '/docs/reference/api/query-builder',
        permanent: true,
      },
      {
        source: '/docs/reference/serve',
        destination: '/docs/reference/api/runtime',
        permanent: true,
      },
      {
        source: '/docs/features/caching',
        destination: '/docs/query-building/caching',
        permanent: true,
      },
      {
        source: '/docs/troubleshooting',
        destination: '/docs/quick-start',
        permanent: true,
      },
      {
        source: '/docs/query-definitions',
        destination: '/docs/reference/api/runtime',
        permanent: true,
      },
      {
        source: '/docs/migration-builder-to-serve',
        destination: '/docs/datasets/serve-integration',
        permanent: true,
      },
      {
        source: '/docs/standalone-query-builder/query-building/:slug',
        destination: '/docs/query-building/:slug',
        permanent: true,
      },
      {
        source: '/docs/standalone-query-builder/:slug',
        destination: '/docs/query-building/:slug',
        permanent: true,
      },
      {
        source: '/docs/reference/api/connection',
        destination: '/docs/reference/connection',
        permanent: true,
      },
      {
        source: '/docs/reference/api/packages',
        destination: '/docs/reference/packages',
        permanent: true,
      },
      {
        source: '/docs/functions/query-builder/ctes',
        destination: '/docs/query-building/subqueries-ctes',
        permanent: true,
      },
      {
        source: '/docs/functions/query-builder/:slug',
        destination: '/docs/query-building/:slug',
        permanent: true,
      },
      {
        source: '/docs/serve/authentication',
        destination: '/docs/authentication',
        permanent: true,
      },
      {
        source: '/docs/serve/caching',
        destination: '/docs/datasets/caching',
        permanent: true,
      },
      {
        source: '/docs/deploy/embedded-runtime',
        destination: '/docs/embedded-runtime',
        permanent: true,
      },
      {
        source: '/docs/deploy/http-openapi',
        destination: '/docs/http-openapi',
        permanent: true,
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: '/docs/:path*.mdx',
        destination: '/llms.mdx/docs/:path*',
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'img.shields.io',
      },
    ],
  },
};

export default withMDX(nextConfig);
