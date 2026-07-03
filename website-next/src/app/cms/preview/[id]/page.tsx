import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { notFound, redirect } from 'next/navigation';
import MarkdownContent from '@/components/MarkdownContent';
import { getAdminPostById } from '@/lib/blog-cms';
import { isCmsAuthenticated } from '@/lib/cms-auth';

export default async function CmsPreviewPostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await isCmsAuthenticated())) {
    redirect('/cms/login');
  }

  const { id } = await params;
  const post = await getAdminPostById(id);

  if (!post) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-24 pt-12 lg:px-8">
      <div className="mb-8 flex flex-wrap items-center gap-3">
        <Link
          href={`/cms/${post.id}`}
          className="inline-flex items-center gap-2 text-sm text-gray-300 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to editor
        </Link>
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-wide text-gray-300">
          Preview {post.status}
        </span>
      </div>

      <article>
        <div className="mb-8">
          <time
            dateTime={post.publishedAt ?? ''}
            className="text-sm text-gray-400"
          >
            {post.publishedAt
              ? new Date(post.publishedAt).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })
              : 'Not published yet'}
          </time>
          <h1 className="font-display mt-3 text-4xl font-bold tracking-tight text-white sm:text-5xl">
            {post.title}
          </h1>
          {post.description && (
            <p className="mt-4 text-xl text-gray-300">
              {post.description}
            </p>
          )}
        </div>

        <div className="prose prose-invert max-w-none">
          <MarkdownContent content={post.body} />
        </div>
      </article>
    </div>
  );
}
