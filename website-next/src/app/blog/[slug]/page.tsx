import type { Metadata } from 'next';
import { getPostBySlug } from '@/lib/blog';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import CodeHighlight from '@/components/CodeHighlight';
import { getCanonicalUrl } from '@/lib/seo';
import StructuredData from '@/components/StructuredData';
import { getPosts } from '@/lib/blog';
import { isBlogTopicSlug } from '@/lib/blog-topics';
import Breadcrumbs from '@/components/Breadcrumbs';

export async function generateStaticParams() {
  const { getPosts } = await import('@/lib/blog');
  const posts = await getPosts();

  return posts.map((post) => ({
    slug: post.slug,
  }));
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
  const description = post.data.seoDescription ?? post.data.description ?? '';
  const canonical = getCanonicalUrl(`/blog/${post.slug}`);

  return {
    title,
    description,
    alternates: {
      canonical,
    },
    openGraph: {
      title,
      description,
      url: canonical,
      type: 'article',
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
  const relatedPosts = (await getPosts())
    .filter((candidate) => candidate.slug !== post.slug)
    .map((candidate) => ({
      post: candidate,
      score: candidate.data.tags?.filter((tag) => data.tags?.includes(tag)).length ?? 0,
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((candidate) => candidate.post);
  const canonical = getCanonicalUrl(`/blog/${post.slug}`).toString();
  const description = data.seoDescription ?? data.description ?? '';
  const articleStructuredData = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: data.seoTitle ?? data.title,
    description,
    datePublished: publishDate,
    dateModified: publishDate,
    mainEntityOfPage: canonical,
    url: canonical,
    author: data.author
      ? {
          '@type': 'Person',
          name: data.author,
        }
      : {
          '@type': 'Organization',
          name: 'hypequery',
        },
    publisher: {
      '@type': 'Organization',
      name: 'hypequery',
      url: getCanonicalUrl('/').toString(),
    },
    keywords: data.tags,
  };
  const breadcrumbStructuredData = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Home',
        item: getCanonicalUrl('/').toString(),
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Blog',
        item: getCanonicalUrl('/blog').toString(),
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: data.title,
        item: canonical,
      },
    ],
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-24 pt-28 lg:px-8">
      <StructuredData data={[articleStructuredData, breadcrumbStructuredData]} />
      <div className="mb-8">
        <Breadcrumbs
          items={[
            { label: 'Home', href: '/' },
            { label: 'Blog', href: '/blog' },
            { label: data.title },
          ]}
          className="mb-5"
        />
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
          {data.tags?.length ? (
            <div className="mt-6 flex flex-wrap gap-2">
              {data.tags.map((tag) => (
                isBlogTopicSlug(tag) ? (
                  <Link
                    key={tag}
                    href={`/blog/topics/${tag}`}
                    className="rounded-full border border-gray-200 px-3 py-1 text-sm text-gray-700 hover:border-indigo-300 hover:text-indigo-600 dark:border-gray-700 dark:text-gray-300 dark:hover:border-indigo-500 dark:hover:text-indigo-400"
                  >
                    {tag}
                  </Link>
                ) : (
                  <span
                    key={tag}
                    className="rounded-full border border-gray-200 px-3 py-1 text-sm text-gray-700 dark:border-gray-700 dark:text-gray-300"
                  >
                    {tag}
                  </span>
                )
              ))}
            </div>
          ) : null}
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

        {relatedPosts.length ? (
          <section className="mt-14 border-t border-gray-200 pt-10 dark:border-gray-800">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm uppercase tracking-[0.2em] text-indigo-500">
                  Keep exploring
                </p>
                <h2 className="font-display mt-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">
                  Related posts on this topic
                </h2>
              </div>
              <Link
                href="/blog/topics"
                className="text-sm font-semibold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
              >
                All topic hubs
              </Link>
            </div>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {relatedPosts.map((relatedPost) => (
                <article
                  key={relatedPost.slug}
                  className="rounded-3xl border border-gray-200 p-5 dark:border-gray-800"
                >
                  <h3 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100">
                    <Link href={`/blog/${relatedPost.slug}`} className="hover:text-indigo-600 dark:hover:text-indigo-400">
                      {relatedPost.data.title}
                    </Link>
                  </h3>
                  {relatedPost.data.description ? (
                    <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">
                      {relatedPost.data.description}
                    </p>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </article >
    </div >
  );
}
