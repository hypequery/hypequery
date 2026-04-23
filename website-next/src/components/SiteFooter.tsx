import Link from 'next/link';
import { seoFooterGroups } from '@/data/seo-links';

function GitHubIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
      />
    </svg>
  );
}

function XIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M18.244 3H21.5l-7.5 8.568L22 21h-5.156l-4.03-4.888L8.113 21H4.856l7.938-9.06L2.5 3h5.289l3.64 4.523L18.244 3zm-1.804 16.2h1.402L7.56 4.695H6.07l10.37 14.505z" />
    </svg>
  );
}

function LinkedInIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.026-3.037-1.852-3.037-1.853 0-2.137 1.447-2.137 2.943v5.663H9.354V9h3.414v1.561h.047c.476-.9 1.637-1.85 3.37-1.85 3.604 0 4.27 2.372 4.27 5.456v6.285zM5.337 7.433a2.062 2.062 0 01-2.063-2.058A2.062 2.062 0 015.337 3.32a2.062 2.062 0 012.062 2.055 2.062 2.062 0 01-2.062 2.058zM3.56 20.452h3.553V9H3.56v11.452z" />
    </svg>
  );
}

export default function SiteFooter() {
  return (
    <footer className="border-t border-white/10 px-4 py-10 sm:px-6">
      <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1fr_2fr]">
        <div>
          <Link href="/" className="font-mono text-[15px] font-bold tracking-[-0.02em] text-white">
            &gt; hypequery
          </Link>
          <p className="mt-3 max-w-md text-sm leading-7 text-slate-400">
            The type-safe query builder for ClickHouse. Build queries once, reuse them across product APIs,
            dashboards, jobs, and agents.
          </p>
        </div>
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {seoFooterGroups.map((group) => (
            <div key={group.title}>
              <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                {group.title}
              </h2>
              <div className="mt-4 flex flex-col gap-3 text-sm text-slate-400">
                {group.links.map((item) => (
                  <Link key={item.href} href={item.href} className="transition hover:text-white">
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="mx-auto mt-8 flex max-w-7xl flex-col gap-5 border-t border-white/10 pt-6">
        <p className="text-sm text-slate-500">
          Feedback?{' '}
          <a
            href="https://github.com/hypequery/hypequery/issues"
            target="_blank"
            rel="noreferrer"
            className="text-slate-400 transition hover:text-white"
          >
            Open an issue
          </a>{' '}
          or DM{' '}
          <a href="https://x.com/hypequery" target="_blank" rel="noreferrer" className="text-slate-400 transition hover:text-white">
            @hypequery
          </a>
          .
        </p>
      </div>
      <div className="mx-auto mt-8 flex max-w-7xl flex-col gap-4 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
        <span>© 2026 hypequery. All rights reserved.</span>
        <div className="flex items-center gap-4 text-slate-400">
          <a href="https://github.com/hypequery/hypequery" target="_blank" rel="noreferrer" className="transition hover:text-white">
            <GitHubIcon />
          </a>
          <a href="https://x.com/hypequery" target="_blank" rel="noreferrer" className="transition hover:text-white">
            <XIcon />
          </a>
          <a
            href="https://www.linkedin.com/company/110435355/"
            target="_blank"
            rel="noreferrer"
            className="transition hover:text-white"
          >
            <LinkedInIcon />
          </a>
        </div>
      </div>
    </footer>
  );
}
