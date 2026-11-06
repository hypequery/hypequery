import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
import { marketing } from '@/components/ui/marketing';
import { CHANGELOG_PACKAGES } from '@/lib/changelog/packages';

interface ChangelogShellProps {
  /** Slug of the package being shown, or null for the all-packages timeline. */
  activeSlug: string | null;
  /** Latest version per package slug, shown next to each filter entry. */
  latestVersions: Record<string, string | undefined>;
  eyebrow: string;
  title: string;
  lead: ReactNode;
  children: ReactNode;
}

function filterClass(active: boolean) {
  return active
    ? 'border-accent-hi bg-accent-soft text-accent'
    : 'border-transparent text-text-muted hover:border-border hover:text-text';
}

export function ChangelogShell({ activeSlug, latestVersions, eyebrow, title, lead, children }: ChangelogShellProps) {
  const filters = [
    { slug: null, label: 'All', href: '/changelog', version: undefined },
    ...CHANGELOG_PACKAGES.map((pkg) => ({
      slug: pkg.slug,
      label: pkg.label,
      href: `/changelog/${pkg.slug}`,
      version: latestVersions[pkg.slug],
    })),
  ];

  return (
    <>
      <section className="border-b border-border">
        <div className={`${marketing.container} pb-12 pt-12 sm:pb-14 sm:pt-16`}>
          <p className={marketing.eyebrow}>{eyebrow}</p>
          <h1 className={`mt-5 max-w-[900px] [overflow-wrap:anywhere] ${marketing.heroTitle}`}>
            {/* Package names are one long word; let `@hypequery/` wrap before the package part. */}
            {title.split('/').map((part, index) => (
              <Fragment key={part}>
                {index > 0 ? (
                  <>
                    /<wbr />
                  </>
                ) : null}
                {part}
              </Fragment>
            ))}
          </h1>
          <div className={`mt-5 max-w-[720px] ${marketing.heroLead}`}>{lead}</div>
          <p className="mt-6 flex flex-wrap gap-x-4 gap-y-2 text-sm text-text-muted">
            <a href="/changelog/rss.xml" className="underline underline-offset-2 hover:text-text">
              RSS feed
            </a>
            <a
              href="https://github.com/hypequery/hypequery"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 hover:text-text"
            >
              GitHub
            </a>
          </p>
        </div>
      </section>

      <div className={`${marketing.container} grid gap-10 py-12 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-14 lg:py-16`}>
        <nav aria-label="Filter by package" className="min-w-0 lg:sticky lg:top-28 lg:self-start">
          <p className="mb-3 font-mono text-[11.5px] font-bold uppercase tracking-[0.12em] text-text-dim max-lg:hidden">
            Packages
          </p>
          <ul className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-2 lg:mx-0 lg:flex-col lg:gap-1 lg:overflow-visible lg:px-0 lg:pb-0">
            {filters.map((filter) => {
              const active = filter.slug === activeSlug;
              return (
                <li key={filter.href} className="shrink-0">
                  <Link
                    href={filter.href}
                    aria-current={active ? 'page' : undefined}
                    className={`flex items-center justify-between gap-3 whitespace-nowrap rounded-lg border px-3 py-1.5 font-mono text-[13px] transition ${filterClass(active)}`}
                  >
                    <span>{filter.label}</span>
                    {filter.version ? (
                      <span className="text-[11px] text-text-dim max-lg:hidden">{filter.version}</span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="min-w-0">{children}</div>
      </div>
    </>
  );
}
