import { getPostBySlug } from '@/lib/blog';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import CodeHighlight from '@/components/CodeHighlight';
import RelatedContent, { type RelatedContentLink } from '@/components/RelatedContent';
import type { Metadata } from 'next';
import { getPosts } from '@/lib/blog';
import { absoluteUrl } from '@/lib/site';
import { comparePageBySlug } from '@/data/compare-pages';

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
  const comparePage = comparePageBySlug[slug as keyof typeof comparePageBySlug];

  if (comparePage) {
    redirect(comparePage.href);
  }

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
  const comparePage = comparePageBySlug[slug as keyof typeof comparePageBySlug];

  if (comparePage) {
    redirect(comparePage.href);
  }

  const post = await getPostBySlug(slug);

  if (!post) {
    notFound();
  }

  const { data, content } = post;
  const publishDate = data.date;
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
        <RelatedContent links={relatedLinks} />
      </article >
    </div >
  );
}
