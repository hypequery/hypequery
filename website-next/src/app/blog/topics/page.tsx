import type { Metadata } from 'next';
import Link from 'next/link';
import { blogTopics } from '@/lib/blog-topics';
import { getCanonicalUrl } from '@/lib/seo';

export const metadata: Metadata = {
  title: 'Analytics Topic Hubs',
  description:
    'Topic hubs for ClickHouse engineering, analytics APIs, semantic layers, schema management, and analytics architecture.',
  alternates: {
    canonical: getCanonicalUrl('/blog/topics'),
  },
};

export default function BlogTopicsPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-16 lg:px-8">
      <div className="rounded-3xl border border-gray-200 bg-white p-8 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <p className="text-sm uppercase tracking-[0.2em] text-indigo-500">Topic hubs</p>
        <h1 className="font-display mt-4 text-4xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
          Browse the blog by topic, not publish date
        </h1>
        <p className="mt-4 max-w-3xl text-lg text-gray-600 dark:text-gray-300">
          Each topic page brings together related articles and docs so you can go
          deeper on one part of the analytics stack at a time.
        </p>
      </div>

      <div className="mt-10 grid gap-6 md:grid-cols-2">
        {blogTopics.map((topic) => (
          <Link
            key={topic.slug}
            href={`/blog/topics/${topic.slug}`}
            className="rounded-3xl border border-gray-200 bg-white p-8 shadow-sm transition hover:-translate-y-1 hover:border-indigo-300 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-indigo-500"
          >
            <h2 className="font-display text-2xl font-semibold text-gray-900 dark:text-gray-100">
              {topic.title}
            </h2>
            <p className="mt-3 text-base text-gray-600 dark:text-gray-300">{topic.description}</p>
            <p className="mt-6 text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400">
              Open topic hub
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
