import Link from 'next/link';
import { SetupCommand, type Language } from '@/components/home/SetupCommand';
import { marketing } from '@/components/ui/marketing';

const QUICK_START: Record<Language, { href: string; target: string }> = {
  typescript: { href: '/docs/quick-start', target: 'docs_quick_start' },
  python: { href: '/docs/quick-start#python', target: 'docs_python_quick_start' },
};

/** One line under a blog post's intro that names the product and links to the quick start. */
export function ArticleIntroCta({ language }: { language: Language }) {
  const quickStart = QUICK_START[language];

  return (
    <p className="not-prose mt-6 rounded-lg border border-border bg-bg-card px-4 py-3 text-sm leading-6 text-text-muted">
      <span className="font-semibold text-text">hypequery</span> is an embedded analytics toolkit for ClickHouse: typed
      queries and shared metrics, defined once in your codebase.{' '}
      <Link
        href={quickStart.href}
        data-umami-event="cta_click"
        data-umami-event-target={quickStart.target}
        data-umami-event-location="blog_post_intro"
        className="font-semibold text-accent hover:underline"
      >
        Open the quick start <span aria-hidden="true">→</span>
      </Link>
    </p>
  );
}

/** The "do this with hypequery" block at the end of every blog post. */
export function ArticleCta({ language }: { language: Language }) {
  const quickStart = QUICK_START[language];

  return (
    <section className="not-prose mt-12 rounded-xl border border-border bg-bg-card p-6 shadow-card sm:p-8">
      <p className={marketing.eyebrow}>Do this with hypequery</p>
      <h2 className="mt-3 text-2xl font-medium tracking-tight text-text">Build this in your own codebase</h2>
      <p className="mt-3 max-w-2xl text-sm leading-7 text-text-muted">
        hypequery turns your ClickHouse tables into typed queries and shared metrics. Define them once, then serve the
        same definitions to APIs, dashboards, and AI agents.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Link
          href={quickStart.href}
          data-umami-event="cta_click"
          data-umami-event-target={quickStart.target}
          data-umami-event-location="blog_post_end"
          className={marketing.primaryButton}
        >
          Open the quick start <span aria-hidden="true">→</span>
        </Link>
        <a
          href="https://github.com/hypequery/hypequery"
          target="_blank"
          rel="noreferrer"
          data-umami-event="cta_click"
          data-umami-event-target="github_repo"
          data-umami-event-location="blog_post_end"
          className={marketing.secondaryButton}
        >
          Star on GitHub
        </a>
      </div>
      <SetupCommand className="mt-4" defaultLanguage={language} location="blog_post_end" />
    </section>
  );
}
