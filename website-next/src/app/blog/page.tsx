import type { Metadata } from 'next';
import Link from 'next/link';
import { getPosts } from '@/lib/blog';
import Newsletter from '@/components/Newsletter';
import { blogTopics, isBlogTopicSlug } from '@/lib/blog-topics';
import { getCanonicalUrl } from '@/lib/seo';

export const metadata: Metadata = {
  title: 'ClickHouse Analytics Blog',
  description:
    'Deep dives on ClickHouse, analytics APIs, schema management, multi-tenant analytics, and type-safe data infrastructure.',
  alternates: {
    canonical: getCanonicalUrl('/blog'),
  },
  openGraph: {
    title: 'ClickHouse Analytics Blog',
    description:
      'Deep dives on ClickHouse, analytics APIs, schema management, multi-tenant analytics, and type-safe data infrastructure.',
    url: getCanonicalUrl('/blog'),
    type: 'website',
  },
};

export default async function BlogPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page } = await searchParams;
  const pageNumber = Number(page) || 1;
  const posts = await getPosts();
  const totalPages = Math.ceil(posts.length / 10);

  const startIndex = (pageNumber - 1) * 10;
  const endIndex = startIndex + 10;
  const displayedPosts = posts.slice(startIndex, endIndex);

  return (
    <div className="mx-auto max-w-6xl px-4 py-24 pt-28 lg:px-8">
      <div className="mb-10 text-center p-6 rounded-3xl">
        <p className="text-sm uppercase tracking-[0.2em] text-indigo-500 mb-3">
          Insights
        </p>
        <h1 className="font-display text-4xl font-bold tracking-tight text-gray-900 dark:text-gray-100 sm:text-5xl mb-4">
          Ideas for shipping faster with ClickHouse
        </h1>
        <p className="mt-4 text-lg text-gray-600 dark:text-gray-300">
          Deep dives, architecture notes, and product guidance from the hypequery team.
        </p>
      </div>

      <Newsletter />

      <div className="mb-14 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-indigo-500">
              Topic hubs
            </p>
            <h2 className="font-display mt-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">
              Start with the topic that matches what you are building
            </h2>
            <p className="mt-2 text-gray-600 dark:text-gray-300">
              Explore related guides and docs grouped around the same problem area.
            </p>
          </div>
          <Link
            href="/blog/topics"
            className="text-sm font-semibold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
          >
            View all topics
          </Link>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          {blogTopics.map((topic) => (
            <Link
              key={topic.slug}
              href={`/blog/topics/${topic.slug}`}
              className="rounded-full border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:border-indigo-300 hover:text-indigo-600 dark:border-gray-700 dark:text-gray-300 dark:hover:border-indigo-500 dark:hover:text-indigo-400"
            >
              {topic.title}
            </Link>
          ))}
        </div>
      </div>

      <div className="space-y-12">
        {displayedPosts.map((post) => (
          <article
            key={post.slug}
            className="border-b border-gray-200 pb-12 dark:border-gray-800"
          >
            <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
              <time dateTime={post.data.date ?? ''}>
                {new Date(post.data.date ?? '1970-01-01T00:00:00.000Z').toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </time>
            </div>
            <h2 className="font-display mt-3 text-2xl font-bold text-gray-900 dark:text-gray-100">
              <Link
                href={`/blog/${post.slug}`}
                className="hover:text-indigo-600 dark:hover:text-indigo-400"
              >
                {post.data.title}
              </Link>
            </h2>
            {post.data.description && (
              <p className="mt-3 text-lg text-gray-600 dark:text-gray-300 line-clamp-3">
                {post.data.description}
              </p>
            )}
            <div className="mt-4">
              <div className="mb-4 flex flex-wrap gap-2">
                {post.data.tags?.map((tag) => (
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
              <Link
                href={`/blog/${post.slug}`}
                className="inline-flex items-center gap-2 text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 font-medium"
              >
                Read more →
              </Link>
            </div>
          </article>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="mt-12 flex justify-center gap-4">
          {pageNumber > 1 && (
            <Link
              href={`/blog?page=${pageNumber - 1}`}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              Previous
            </Link>
          )}
          <span className="flex items-center text-sm text-gray-600 dark:text-gray-400">
            Page {pageNumber} of {totalPages}
          </span>
          {pageNumber < totalPages && (
            <Link
              href={`/blog?page=${pageNumber + 1}`}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              Next
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
