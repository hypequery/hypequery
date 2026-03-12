import { loginAction } from '@/app/cms/actions';
import { isCmsConfigured } from '@/lib/cms-auth';

export default async function CmsLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const configured = isCmsConfigured();

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#050816] px-6 text-white">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-black/30 p-8 shadow-2xl">
        <p className="font-mono text-sm uppercase tracking-[0.3em] text-indigo-300">Private</p>
        <h1 className="mt-4 text-3xl font-semibold">Blog CMS</h1>
        <p className="mt-3 text-sm leading-6 text-gray-400">
          Sign in to create drafts, edit published posts, and publish changes live from the database.
        </p>

        {!configured && (
          <div className="mt-6 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
            Set `CMS_ADMIN_PASSWORD` in your environment before using the CMS.
          </div>
        )}

        {error === 'invalid' && (
          <div className="mt-6 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-100">
            Invalid password.
          </div>
        )}

        <form action={loginAction} className="mt-8 space-y-4">
          <label className="block space-y-2">
            <span className="text-sm font-medium text-gray-200">Password</span>
            <input
              type="password"
              name="password"
              className="w-full rounded-xl border border-white/10 bg-gray-950 px-4 py-3 text-sm text-white outline-none"
              required
            />
          </label>
          <button
            type="submit"
            disabled={!configured}
            className="w-full rounded-xl bg-indigo-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-gray-700"
          >
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
