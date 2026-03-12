import { getPostBySlug } from '@/lib/blog';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import CodeHighlight from '@/components/CodeHighlight';

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

  return (
    <div className="mx-auto max-w-4xl px-4 py-24 pt-28 lg:px-8">
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
      </article >
    </div >
  );
}
