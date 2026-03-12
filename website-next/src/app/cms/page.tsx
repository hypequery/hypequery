import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  getAdminPosts,
  getCmsStorageLabel,
  isCmsDurableStorageConfigured,
} from '@/lib/blog-cms';
import { isCmsAuthenticated } from '@/lib/cms-auth';

function formatDate(value: string | null) {
  if (!value) {
    return 'Not published';
  }

  return new Date(value).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default async function CmsIndexPage() {
  if (!(await isCmsAuthenticated())) {
    redirect('/cms/login');
  }

  const posts = await getAdminPosts();
  const storageLabel = getCmsStorageLabel();
  const durableStorage = isCmsDurableStorageConfigured();

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/5 p-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-indigo-300">Content</p>
          <h1 className="mt-3 text-3xl font-semibold">Blog posts</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-400">
            Published posts are read from {storageLabel}, so updating content here does not require a git commit.
          </p>
        </div>
        <Link
          href="/cms/new"
          className="inline-flex items-center justify-center rounded-xl bg-indigo-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-400"
        >
          New post
        </Link>
      </div>

      {!durableStorage && (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
          Durable CMS storage is not configured. Set `BLOB_READ_WRITE_TOKEN` to use Vercel Blob in deployed environments. The current local SQLite mode is for development only.
        </div>
      )}

      <div className="overflow-hidden rounded-3xl border border-white/10 bg-black/20">
        <table className="min-w-full divide-y divide-white/10 text-sm">
          <thead className="bg-white/5 text-left text-gray-400">
            <tr>
              <th className="px-6 py-4 font-medium">Title</th>
              <th className="px-6 py-4 font-medium">Status</th>
              <th className="px-6 py-4 font-medium">Source</th>
              <th className="px-6 py-4 font-medium">Updated</th>
              <th className="px-6 py-4 font-medium">Published</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {posts.map((post) => (
              <tr key={post.id} className="text-gray-200">
                <td className="px-6 py-4">
                  <Link href={`/cms/${post.id}`} className="font-medium text-white hover:text-indigo-300">
                    {post.title}
                  </Link>
                  <div className="mt-1 font-mono text-xs text-gray-500">/{post.slug}</div>
                </td>
                <td className="px-6 py-4">
                  <span className="inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-wide text-gray-200">
                    {post.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-gray-400">{post.source}</td>
                <td className="px-6 py-4 text-gray-400">{formatDate(post.updatedAt)}</td>
                <td className="px-6 py-4 text-gray-400">{formatDate(post.publishedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
