import type { BlogPost } from '@/lib/blog';

export type BlogTopic = {
  slug: string;
  title: string;
  description: string;
  intro: string;
  targetKeywords: string[];
  relatedDocs: Array<{ title: string; href: string }>;
};

export const blogTopics: BlogTopic[] = [
  {
    slug: 'clickhouse',
    title: 'ClickHouse Engineering',
    description:
      'Performance patterns, dashboard architectures, materialized views, and production guidance for teams building on ClickHouse.',
    intro:
      'This hub collects implementation guides for teams using ClickHouse as the execution layer behind analytics products, dashboards, and APIs.',
    targetKeywords: [
      'clickhouse analytics backend',
      'clickhouse product analytics',
      'clickhouse dashboards',
      'clickhouse materialized views',
    ],
    relatedDocs: [
      { title: 'Introduction', href: '/docs/introduction' },
      { title: 'Quick Start', href: '/docs/quick-start' },
      { title: 'Observability', href: '/docs/observability' },
    ],
  },
  {
    slug: 'analytics-api',
    title: 'Analytics APIs',
    description:
      'Type-safe analytics API patterns for internal tools, customer-facing products, React apps, and background jobs.',
    intro:
      'This hub focuses on the application layer between your warehouse and your consumers: typed query definitions, generated clients, and reusable analytics contracts.',
    targetKeywords: [
      'analytics api',
      'type safe analytics api',
      'clickhouse api layer',
      'analytics backend typescript',
    ],
    relatedDocs: [
      { title: 'Query Definitions', href: '/docs/query-definitions' },
      { title: 'HTTP + OpenAPI', href: '/docs/http-openapi' },
      { title: 'React Getting Started', href: '/docs/react/getting-started' },
    ],
  },
  {
    slug: 'semantic-layer',
    title: 'Semantic Layer Alternatives',
    description:
      'Posts on semantic layers, analytics language layers, and architectural alternatives for governed self-service analytics.',
    intro:
      'This hub is for teams evaluating whether they need a semantic layer, an analytics API, or a thinner typed abstraction over ClickHouse.',
    targetKeywords: [
      'clickhouse semantic layer',
      'semantic layer alternative',
      'analytics language layer',
      'self service analytics architecture',
    ],
    relatedDocs: [
      { title: 'Why hypequery', href: '/docs/why-hypequery' },
      { title: 'Serve Runtime', href: '/docs/serve-runtime' },
      { title: 'Multi-tenancy', href: '/docs/multi-tenancy' },
    ],
  },
  {
    slug: 'schema-management',
    title: 'Schema Management',
    description:
      'Guidance for schema drift, type generation, and keeping ClickHouse schema changes aligned with application code.',
    intro:
      'This hub covers the operational side of type-safe analytics: schema evolution, generated types, and workflows that keep queries in sync with the warehouse.',
    targetKeywords: [
      'clickhouse schema drift',
      'clickhouse typescript schema',
      'type safe schema management clickhouse',
      'clickhouse type generation',
    ],
    relatedDocs: [
      { title: 'Schemas', href: '/docs/schemas' },
      { title: 'Manual Installation', href: '/docs/manual-installation' },
      { title: 'CLI Reference', href: '/docs/reference/cli' },
    ],
  },
  {
    slug: 'analytics-architecture',
    title: 'Analytics Architecture',
    description:
      'Design patterns for multi-tenant analytics, internal product APIs, query governance, and scaled analytics systems.',
    intro:
      'This hub groups architectural patterns for product teams and platform teams building reusable analytics systems instead of one-off dashboards.',
    targetKeywords: [
      'multi tenant analytics architecture',
      'internal analytics api',
      'analytics architecture clickhouse',
      'product analytics backend architecture',
    ],
    relatedDocs: [
      { title: 'Use Cases', href: '/use-cases' },
      { title: 'Authentication', href: '/docs/authentication' },
      { title: 'Multi-tenancy', href: '/docs/multi-tenancy' },
    ],
  },
];

export function getBlogTopic(slug: string) {
  return blogTopics.find((topic) => topic.slug === slug) ?? null;
}

export function isBlogTopicSlug(slug: string) {
  return blogTopics.some((topic) => topic.slug === slug);
}

export function getPostsForTopic(posts: BlogPost[], topicSlug: string) {
  return posts.filter((post) => post.data.tags?.includes(topicSlug));
}
