import type { NextConfig } from "next";
import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

const nextConfig: NextConfig = {
  trailingSlash: false,
  async redirects() {
    return [
      {
        source: '/:path*',
        has: [
          {
            type: 'host',
            value: 'hypequery.com',
          },
        ],
        destination: 'https://www.hypequery.com/:path*',
        permanent: true,
      },
      {
        source: '/blog/hypequery-vs-clickhouse-client',
        destination: '/compare/hypequery-vs-clickhouse-client',
        permanent: true,
      },
      {
        source: '/blog/hypequery-vs-kysely',
        destination: '/compare/hypequery-vs-kysely',
        permanent: true,
      },
      {
        source: '/docs/installation',
        destination: '/docs/quick-start',
        permanent: true,
      },
      {
        source: '/docs/quick-start-builder',
        destination: '/docs/standalone-query-builder/when-to-use',
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
        destination: '/docs/reference/query-builder',
        permanent: true,
      },
      {
        source: '/docs/reference/serve',
        destination: '/docs/legacy-serve/reference/serve',
        permanent: true,
      },
      {
        source: '/docs/features/caching',
        destination: '/docs/caching',
        permanent: true,
      },
      {
        source: '/docs/troubleshooting',
        destination: '/docs/quick-start',
        permanent: true,
      },
      {
        source: '/docs/query-definitions',
        destination: '/docs/legacy-serve/query-definitions',
        permanent: true,
      },
      {
        source: '/docs/migration-builder-to-serve',
        destination: '/docs/legacy-serve/migration-builder-to-serve',
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
        destination: '/docs/caching',
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
