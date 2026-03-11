import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import CmsEditorForm from '@/components/cms/CmsEditorForm';
import { getAdminPostById } from '@/lib/blog-cms';
import { isCmsAuthenticated } from '@/lib/cms-auth';

export default async function CmsEditPostPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  if (!(await isCmsAuthenticated())) {
    redirect('/cms/login');
  }

  const { id } = await params;
  const { saved } = await searchParams;
  const post = await getAdminPostById(id);

  if (!post) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/5 p-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-indigo-300">Edit</p>
          <h1 className="mt-3 text-3xl font-semibold">{post.title}</h1>
          <p className="mt-2 text-sm leading-6 text-gray-400">
            Source: {post.source}. Last updated {new Date(post.updatedAt).toLocaleString('en-US')}.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            href={`/cms/preview/${post.id}`}
            className="rounded-xl border border-white/10 px-5 py-3 text-sm font-semibold text-gray-200 transition hover:border-white/20 hover:bg-white/5"
          >
            Preview draft
          </Link>
          {post.status === 'published' && (
            <Link
              href={`/blog/${post.slug}`}
              className="rounded-xl border border-white/10 px-5 py-3 text-sm font-semibold text-gray-200 transition hover:border-white/20 hover:bg-white/5"
            >
              View live post
            </Link>
          )}
        </div>
      </div>

      {saved === '1' && (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-100">
          Changes saved.
        </div>
      )}

      <CmsEditorForm post={post} />
    </div>
  );
}
