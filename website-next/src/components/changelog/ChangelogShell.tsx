import Link from 'next/link';
import { Rss } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { marketing } from '@/components/ui/marketing';
import { CHANGELOG_PACKAGES } from '@/lib/changelog/packages';

interface ChangelogShellProps {
  /** Slug of the package being shown, or null for the all-packages timeline. */
  activeSlug: string | null;
  /** Latest version per package slug, shown next to each filter entry. */
  latestVersions: Record<string, string | undefined>;
  title: string;
  lead: ReactNode;
  children: ReactNode;
}

function filterClass(active: boolean) {
  return active
    ? 'border-accent-hi bg-accent-soft text-accent'
    : 'border-transparent text-text-muted hover:border-border hover:text-text';
}

export function ChangelogShell({ activeSlug, latestVersions, title, lead, children }: ChangelogShellProps) {
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
      <header className={`${marketing.container} pt-10 sm:pt-12`}>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-border pb-6">
          <div className="min-w-0">
            <h1 className="text-3xl font-medium tracking-tight text-text [overflow-wrap:anywhere] sm:text-4xl">
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
            <div className="mt-2 max-w-[640px] text-sm leading-6 text-text-muted sm:text-base">{lead}</div>
          </div>
          <a
            href="/changelog/rss.xml"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-text-muted transition hover:border-border-strong hover:text-text"
          >
            <Rss aria-hidden="true" className="h-3.5 w-3.5" />
            RSS
          </a>
        </div>
      </header>

      <div className={`${marketing.container} grid gap-8 py-8 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-12 lg:py-10`}>
        <nav aria-label="Filter by package" className="min-w-0 lg:sticky lg:top-28 lg:self-start">
          <p className="mb-3 font-mono text-[11.5px] font-bold uppercase tracking-[0.12em] text-text-dim max-lg:hidden">
            Packages
          </p>
          <ul className="flex flex-wrap gap-1.5 lg:flex-col lg:gap-1">
            {filters.map((filter) => {
              const active = filter.slug === activeSlug;
              return (
                <li key={filter.href}>
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
