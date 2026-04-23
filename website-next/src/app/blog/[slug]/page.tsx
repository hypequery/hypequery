import { getPostBySlug } from '@/lib/blog';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import CodeHighlight from '@/components/CodeHighlight';
import RelatedContent, { type RelatedContentLink } from '@/components/RelatedContent';
import type { Metadata } from 'next';
import { getPosts } from '@/lib/blog';
import { absoluteUrl } from '@/lib/site';

const comparisonSummaries: Record<
  string,
  {
    title: string;
    verdict: string;
    rows: Array<{ label: string; hypequery: string; alternative: string }>;
    faq: Array<{ question: string; answer: string }>;
  }
> = {
  'hypequery-vs-clickhouse-client': {
    title: 'Quick comparison: hypequery vs @clickhouse/client',
    verdict:
      '@clickhouse/client is the right low-level client. hypequery is the better fit when you need generated schema types, reusable query definitions, typed APIs, and frontend consumption on top of ClickHouse.',
    rows: [
      {
        label: 'Best for',
        hypequery: 'Type-safe analytics layers and app backends',
        alternative: 'Direct ClickHouse access and raw queries',
      },
      {
        label: 'Type safety',
        hypequery: 'Generated from your ClickHouse schema',
        alternative: 'Manual response annotations',
      },
      {
        label: 'Reuse',
        hypequery: 'One query definition across local execution, HTTP, and React',
        alternative: 'You build the abstraction yourself',
      },
    ],
    faq: [
      {
        question: 'Does hypequery replace @clickhouse/client?',
        answer: 'No. hypequery builds on the same ClickHouse access model and adds typed query and serving layers for application teams.',
      },
      {
        question: 'When should I stay with the official client?',
        answer: 'Stay with the official client for one-off scripts, inserts, streaming, or cases where raw SQL control is the main requirement.',
      },
    ],
  },
  'hypequery-vs-kysely': {
    title: 'Quick comparison: hypequery vs Kysely',
    verdict:
      'Kysely is an excellent general TypeScript query builder. hypequery is narrower: it is built for ClickHouse runtime type mapping, schema generation, and reusable analytics APIs.',
    rows: [
      {
        label: 'Best for',
        hypequery: 'ClickHouse-first TypeScript analytics',
        alternative: 'General SQL query building, especially Postgres',
      },
      {
        label: 'Schema source',
        hypequery: 'Generated from live ClickHouse schema',
        alternative: 'Usually hand-maintained TypeScript interfaces',
      },
      {
        label: 'Application layer',
        hypequery: 'Query builder, HTTP serving, OpenAPI, React hooks',
        alternative: 'Query builder only',
      },
    ],
    faq: [
      {
        question: 'Can Kysely work with ClickHouse?',
        answer: 'Yes, but you still need to handle ClickHouse-specific runtime type mappings and application-level reuse yourself.',
      },
      {
        question: 'When is hypequery a better fit?',
        answer: 'Use hypequery when ClickHouse is powering dashboards, APIs, jobs, or SaaS analytics where the same typed query contract needs to be reused.',
      },
    ],
  },
};

export async function generateStaticParams() {
  const posts = await getPosts();
  return posts.map((post) => ({ slug: post.slug }));
}

function getRelatedLinks(slug: string): RelatedContentLink[] {
  if (slug === 'hypequery-vs-clickhouse-client' || slug === 'hypequery-vs-kysely') {
    return [
      {
        href: '/compare',
        title: 'Compare more options',
        description: 'See the full comparison hub for ClickHouse TypeScript decision guides.',
      },
      {
        href: '/clickhouse-query-builder',
        title: 'ClickHouse query builder',
        description: 'Move from evaluation into the product page for the query-builder workflow.',
      },
      {
        href: '/clickhouse-typescript',
        title: 'ClickHouse TypeScript',
        description: 'See the broader TypeScript workflow beyond the direct tool comparison.',
      },
    ];
  }

  if (slug.includes('nextjs')) {
    return [
      {
        href: '/clickhouse-nextjs',
        title: 'ClickHouse Next.js',
        description: 'The framework guide for App Router, server execution, and typed analytics handlers.',
      },
      {
        href: '/clickhouse-react',
        title: 'ClickHouse React',
        description: 'Continue into typed hooks and client-side analytics consumption patterns.',
      },
      {
        href: '/compare/hypequery-vs-clickhouse-client',
        title: 'hypequery vs @clickhouse/client',
        description: 'If you are still evaluating the stack shape, compare the low-level client path against hypequery.',
      },
    ];
  }

  if (slug.includes('mcp')) {
    return [
      {
        href: '/clickhouse-mcp',
        title: 'ClickHouse MCP',
        description: 'The product page for structured AI-agent access to ClickHouse.',
      },
      {
        href: '/docs/http-openapi',
        title: 'HTTP and OpenAPI docs',
        description: 'See how typed query definitions become documented HTTP endpoints.',
      },
      {
        href: '/clickhouse-query-builder',
        title: 'ClickHouse query builder',
        description: 'The query-builder layer that powers the MCP-safe workflow.',
      },
    ];
  }

  if (slug.includes('react')) {
    return [
      {
        href: '/clickhouse-react',
        title: 'ClickHouse React',
        description: 'The React-specific guide for generated hooks and shared query contracts.',
      },
      {
        href: '/clickhouse-nextjs',
        title: 'ClickHouse Next.js',
        description: 'Pair the React hook layer with a server-side ClickHouse architecture.',
      },
      {
        href: '/compare',
        title: 'Compare options',
        description: 'If you are still deciding on the stack, start with the comparison hub.',
      },
    ];
  }

  return [
    {
      href: '/clickhouse-typescript',
      title: 'ClickHouse TypeScript',
      description: 'The main guide to generated schema types, reusable queries, and typed APIs.',
    },
    {
      href: '/clickhouse-analytics',
      title: 'ClickHouse analytics',
      description: 'The architecture-level guide for building a reusable analytics layer.',
    },
    {
      href: '/compare',
      title: 'Compare options',
      description: 'Move into side-by-side decision guides if you are still evaluating the tooling.',
    },
  ];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPostBySlug(slug);

  if (!post) {
    return {};
  }

  const title = post.data.seoTitle ?? post.data.title;
  const description = post.data.seoDescription ?? post.data.description ?? 'Read the latest hypequery article.';
  const url = absoluteUrl(`/blog/${post.slug}`);

  return {
    title,
    description,
    alternates: {
      canonical: url,
    },
    openGraph: {
      type: 'article',
      url,
      title,
      description,
      publishedTime: post.data.date,
      tags: post.data.tags,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await getPostBySlug(slug);

  if (!post) {
    notFound();
  }

  const { data, content } = post;
  const publishDate = data.date;
  const comparison = comparisonSummaries[post.slug];
  const articleUrl = absoluteUrl(`/blog/${post.slug}`).toString();
  const relatedLinks = getRelatedLinks(post.slug);
  const articleSchema = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: data.title,
    description: data.description ?? undefined,
    datePublished: publishDate ?? undefined,
    dateModified: publishDate ?? undefined,
    mainEntityOfPage: articleUrl,
    author: {
      '@type': 'Organization',
      name: 'hypequery',
    },
    publisher: {
      '@type': 'Organization',
      name: 'hypequery',
      url: absoluteUrl('/').toString(),
    },
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-24 pt-28 lg:px-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }} />
      <div className="mb-8">
        <Link
          href="/blog"
          className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Blog
        </Link>
      </div>

      <article>
        <div className="mb-8">
          <time
            dateTime={publishDate ?? ''}
            className="text-sm text-gray-500 dark:text-gray-400"
          >
            {new Date(publishDate ?? '1970-01-01T00:00:00.000Z').toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </time>
          <h1 className="font-display mt-3 text-4xl font-bold tracking-tight text-gray-900 dark:text-gray-100 sm:text-5xl">
            {data.title}
          </h1>
          {data.description && (
            <p className="mt-4 text-xl text-gray-600 dark:text-gray-300">
              {data.description}
            </p>
          )}
        </div>

        {comparison ? (
          <aside className="mb-10 border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400">
              Comparison guide
            </p>
            <h2 className="mt-3 text-2xl font-bold text-gray-900 dark:text-gray-100">{comparison.title}</h2>
            <p className="mt-4 text-base leading-7 text-gray-600 dark:text-gray-300">{comparison.verdict}</p>
            <div className="mt-6 overflow-hidden border border-gray-200 dark:border-gray-800">
              {comparison.rows.map((row) => (
                <div
                  key={row.label}
                  className="grid gap-4 border-b border-gray-200 p-4 last:border-b-0 md:grid-cols-[0.7fr_1fr_1fr] dark:border-gray-800"
                >
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{row.label}</div>
                  <div className="text-sm leading-6 text-gray-600 dark:text-gray-300">{row.hypequery}</div>
                  <div className="text-sm leading-6 text-gray-600 dark:text-gray-300">{row.alternative}</div>
                </div>
              ))}
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/docs/quick-start"
                className="bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500"
              >
                Get started
              </Link>
              <Link
                href="/clickhouse-query-builder"
                className="border border-gray-300 px-5 py-3 text-sm font-semibold text-gray-900 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-900"
              >
                See the query builder
              </Link>
            </div>
          </aside>
        ) : null}

        <div className="prose prose-gray dark:prose-invert max-w-none">
          <ReactMarkdown
            components={{
              code({ className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || '');
                const code = String(children).replace(/\n$/, '');

                if (!match) {
                  return (
                    <code className={className} {...props}>
                      {children}
                    </code>
                  );
                }

                return (
                  <CodeHighlight
                    code={code}
                    language={match[1]}
                  />
                );
              },
            }}
          >
            {content}
          </ReactMarkdown>
        </div>
        {comparison ? (
          <section className="mt-12 border-t border-gray-200 pt-8 dark:border-gray-800">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">FAQ</h2>
            <div className="mt-6 space-y-6">
              {comparison.faq.map((item) => (
                <div key={item.question}>
                  <h3 className="font-semibold text-gray-900 dark:text-gray-100">{item.question}</h3>
                  <p className="mt-2 text-sm leading-7 text-gray-600 dark:text-gray-300">{item.answer}</p>
                </div>
              ))}
            </div>
          </section>
        ) : null}
        <RelatedContent links={relatedLinks} />
      </article >
    </div >
  );
}
