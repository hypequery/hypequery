import Link from 'next/link';
import MarkdownContent from '@/components/MarkdownContent';
import { packageDisplayName, type ChangelogPackage } from '@/lib/changelog/packages';
import type { ChangelogRelease } from '@/lib/changelog/load';
import type { ReleaseBump } from '@/lib/changelog/parse';
import { BUMP_LABEL, commitUrl, formatReleaseDate, releaseAnchor, releasePath, sectionLabel, truncateSections } from '@/lib/changelog/display';

const BUMP_STYLE: Record<ReleaseBump, string> = {
  major: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  minor: 'border-accent-hi bg-accent-soft text-accent',
  patch: 'border-border-strong bg-bg-alt text-text-muted',
  prerelease: 'border-success/40 bg-success-soft text-success',
};

export function BumpBadge({ bump }: { bump: ReleaseBump }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[11px] font-medium leading-4 ${BUMP_STYLE[bump]}`}
    >
      {BUMP_LABEL[bump]}
    </span>
  );
}

interface ReleaseEntryProps {
  release: ChangelogRelease;
  pkg: ChangelogPackage;
  /** `timeline` names the package and links to its page; `package` shows the date instead. */
  variant: 'timeline' | 'package';
  /** Show at most this many changes, then link to the full release. */
  maxChanges?: number;
}

export function ReleaseEntry({ release, pkg, variant, maxChanges }: ReleaseEntryProps) {
  const anchor = releaseAnchor(pkg.slug, release.version);
  const { sections, hidden } = truncateSections(release.sections, maxChanges);

  return (
    <article
      id={variant === 'package' ? anchor : undefined}
      className="scroll-mt-28 rounded-xl border border-border bg-bg-card p-5 shadow-card sm:p-6"
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {variant === 'timeline' ? (
          <Link href={`/changelog/${pkg.slug}`} className="font-mono text-sm font-semibold text-text hover:text-accent">
            {packageDisplayName(pkg)}
          </Link>
        ) : null}
        <Link
          href={variant === 'timeline' ? releasePath(pkg.slug, release.version) : `#${anchor}`}
          className={`font-mono text-sm ${variant === 'timeline' ? 'text-text-muted' : 'font-semibold text-text'} hover:text-accent`}
        >
          {variant === 'package' ? release.version : `v${release.version}`}
        </Link>
        <BumpBadge bump={release.bump} />
        {variant === 'package' && release.publishedAt ? (
          <time dateTime={release.publishedAt} className="ml-auto text-meta text-text-dim">
            {formatReleaseDate(release.publishedAt)}
          </time>
        ) : null}
      </header>

      {sections.map((section) => (
        <section key={section.title} className="mt-5">
          {section.title ? (
            <h3 className="mb-3 font-mono text-[11.5px] font-semibold uppercase tracking-[0.12em] text-text-dim">
              {sectionLabel(section.title)}
            </h3>
          ) : null}
          <ul className="space-y-3">
            {section.changes.map((change, index) => (
              <li
                key={change.commit ?? index}
                className="relative pl-5 before:absolute before:left-0 before:top-[0.6rem] before:h-1.5 before:w-1.5 before:rounded-full before:bg-accent-hi"
              >
                <div className="prose prose-no-margin min-w-0 max-w-none leading-relaxed [--tw-prose-size:0.9375] [overflow-wrap:anywhere] [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:[overflow-wrap:normal]">
                  <MarkdownContent content={change.markdown} />
                </div>
                {change.commit ? (
                  <a
                    href={commitUrl(change.commit)}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block font-mono text-[11px] text-text-dim hover:text-accent"
                  >
                    {change.commit}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {hidden > 0 ? (
        <Link
          href={releasePath(pkg.slug, release.version)}
          className="mt-5 inline-block text-sm font-medium text-accent hover:underline"
        >
          {hidden} more {hidden === 1 ? 'change' : 'changes'} in this release →
        </Link>
      ) : null}

      {release.dependencyUpdates.length > 0 ? (
        <p className="mt-5 border-t border-border pt-4 text-meta text-text-dim">
          Updated dependencies:{' '}
          {release.dependencyUpdates.map((dependency, index) => (
            <span key={dependency}>
              {index > 0 ? ', ' : null}
              <code className="font-mono text-[12px]">{dependency}</code>
            </span>
          ))}
        </p>
      ) : null}
    </article>
  );
}

/** One-line row for a release that only bumped dependencies. */
export function DependencyRelease({ release, pkg }: { release: ChangelogRelease; pkg: ChangelogPackage }) {
  const anchor = releaseAnchor(pkg.slug, release.version);
  return (
    <div
      id={anchor}
      className="flex scroll-mt-28 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-dashed border-border px-5 py-3 text-meta text-text-dim"
    >
      <Link href={`#${anchor}`} className="font-mono text-sm text-text-muted hover:text-accent">
        {release.version}
      </Link>
      <span>
        Dependency update
        {release.dependencyUpdates.length > 0 ? (
          <>
            {': '}
            {release.dependencyUpdates.map((dependency, index) => (
              <span key={dependency}>
                {index > 0 ? ', ' : null}
                <code className="font-mono text-[12px]">{dependency}</code>
              </span>
            ))}
          </>
        ) : null}
      </span>
      {release.publishedAt ? (
        <time dateTime={release.publishedAt} className="ml-auto">
          {formatReleaseDate(release.publishedAt)}
        </time>
      ) : null}
    </div>
  );
}
