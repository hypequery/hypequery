import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import Newsletter from '@/components/Newsletter';
import { getPosts } from '@/lib/blog';
import { blogTopics, getBlogTopic, getPostsForTopic, isBlogTopicSlug } from '@/lib/blog-topics';
import { getCanonicalUrl } from '@/lib/seo';

export function generateStaticParams() {
  return blogTopics.map((topic) => ({
    topic: topic.slug,
  }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ topic: string }>;
}): Promise<Metadata> {
  const { topic } = await params;
  const topicData = getBlogTopic(topic);

  if (!topicData) {
    return {};
  }

  return {
    title: topicData.title,
    description: topicData.description,
    alternates: {
      canonical: getCanonicalUrl(`/blog/topics/${topicData.slug}`),
    },
  };
}

export default async function BlogTopicPage({
  params,
}: {
  params: Promise<{ topic: string }>;
}) {
  const { topic } = await params;
  const topicData = getBlogTopic(topic);

  if (!topicData) {
    notFound();
  }

  const posts = await getPosts();
  const topicPosts = getPostsForTopic(posts, topicData.slug);

  return (
    <div className="mx-auto max-w-6xl px-4 py-16 lg:px-8">
      <div className="rounded-3xl border border-gray-200 bg-white p-8 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <p className="text-sm uppercase tracking-[0.2em] text-indigo-500">Topic hub</p>
        <h1 className="font-display mt-4 text-4xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
          {topicData.title}
        </h1>
        <p className="mt-4 max-w-3xl text-lg text-gray-600 dark:text-gray-300">
          {topicData.intro}
        </p>
        <div className="mt-8 flex flex-wrap gap-2">
          {topicData.targetKeywords.map((keyword) => (
            <span
              key={keyword}
              className="rounded-full border border-indigo-200 px-3 py-1 text-sm text-indigo-700 dark:border-indigo-500/40 dark:text-indigo-300"
            >
              {keyword}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <div>
          <div className="mb-8 flex items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-2xl font-semibold text-gray-900 dark:text-gray-100">
                Articles in this topic
              </h2>
              <p className="mt-2 text-gray-600 dark:text-gray-300">
                Start here if you want the core guides for this part of the stack.
              </p>
            </div>
            <Link
              href="/blog/topics"
              className="text-sm font-semibold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
            >
              All topics
            </Link>
          </div>

          <div className="space-y-8">
            {topicPosts.map((post) => (
              <article
                key={post.slug}
                className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900"
              >
                <time className="text-sm text-gray-500 dark:text-gray-400" dateTime={post.data.date ?? ''}>
                  {new Date(post.data.date ?? '1970-01-01T00:00:00.000Z').toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </time>
                <h3 className="font-display mt-3 text-2xl font-semibold text-gray-900 dark:text-gray-100">
                  <Link href={`/blog/${post.slug}`} className="hover:text-indigo-600 dark:hover:text-indigo-400">
                    {post.data.title}
                  </Link>
                </h3>
                {post.data.description ? (
                  <p className="mt-3 text-base text-gray-600 dark:text-gray-300">
                    {post.data.description}
                  </p>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-2">
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
              </article>
            ))}
          </div>
        </div>

        <aside className="space-y-6">
          <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <h2 className="font-display text-xl font-semibold text-gray-900 dark:text-gray-100">
              Related docs
            </h2>
            <div className="mt-4 space-y-3">
              {topicData.relatedDocs.map((doc) => (
                <Link
                  key={doc.href}
                  href={doc.href}
                  className="block text-sm text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
                >
                  {doc.title}
                </Link>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <h2 className="font-display text-xl font-semibold text-gray-900 dark:text-gray-100">
              How to use this page
            </h2>
            <p className="mt-3 text-sm leading-7 text-gray-600 dark:text-gray-300">
              Use this as the starting point for the topic, then move into the docs
              and related articles that match your implementation stage.
            </p>
          </div>
        </aside>
      </div>

      <div className="mt-16">
        <Newsletter />
      </div>
    </div>
  );
}
