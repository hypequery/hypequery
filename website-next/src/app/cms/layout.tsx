import { isCmsAuthenticated } from '@/lib/cms-auth';
import Link from 'next/link';
import { logoutAction } from './actions';

export default async function CmsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const authenticated = await isCmsAuthenticated();

  return (
    <div className="min-h-screen bg-[#050816] text-white">
      {authenticated ? (
        <>
          <header className="border-b border-white/10 bg-black/20">
            <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
              <div>
                <Link href="/cms" className="font-mono text-lg font-semibold text-white">
                  hypequery CMS
                </Link>
                <p className="mt-1 text-sm text-gray-400">
                  Publish and edit blog content without a code deploy.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Link
                  href="/blog"
                  className="rounded-lg border border-white/10 px-4 py-2 text-sm text-gray-200 transition hover:border-white/20 hover:bg-white/5"
                >
                  View blog
                </Link>
                <form action={logoutAction}>
                  <button
                    type="submit"
                    className="rounded-lg border border-white/10 px-4 py-2 text-sm text-gray-200 transition hover:border-white/20 hover:bg-white/5"
                  >
                    Log out
                  </button>
                </form>
              </div>
            </div>
          </header>
          <main className="mx-auto max-w-7xl px-6 py-10">{children}</main>
        </>
      ) : (
        children
      )}
    </div>
  );
}
