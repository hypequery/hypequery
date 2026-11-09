import type { Metadata } from 'next';
import Link from 'next/link';
import { ChangelogShell } from '@/components/changelog/ChangelogShell';
import { ReleaseEntry } from '@/components/changelog/ReleaseEntry';
import { getChangelog } from '@/lib/changelog/load';
import { CHANGELOG_PACKAGES, changelogPackageBySlug, packageDisplayName } from '@/lib/changelog/packages';
import { formatReleaseDate } from '@/lib/changelog/display';
import { groupByDay, isDependencyOnly, latestVersionBySlug, sortTimeline } from '@/lib/changelog/timeline';
import { absoluteUrl, ogImage } from '@/lib/site';

// Rebuilt from the package CHANGELOG.md files at most once an hour.
export const revalidate = 3600;

/** Releases shown on the all-packages timeline; older ones live on each package page. */
const TIMELINE_LIMIT = 60;
/** Long releases are cut to this many changes, with a link to the full entry. */
const TIMELINE_MAX_CHANGES = 6;

const title = 'Changelog';
const description =
  'Every hypequery release across the TypeScript packages and the Python SDK, generated from the package changelogs.';

export const metadata: Metadata = {
  title,
  description,
  alternates: {
    canonical: absoluteUrl('/changelog'),
    types: { 'application/rss+xml': absoluteUrl('/changelog/rss.xml').toString() },
  },
  openGraph: {
    type: 'website',
    url: absoluteUrl('/changelog'),
    title: 'hypequery changelog',
    description,
    images: ogImage('hypequery changelog'),
  },
};

export default async function ChangelogPage() {
  const { packages } = await getChangelog();
  const releases = sortTimeline(
    packages,
    CHANGELOG_PACKAGES.map((pkg) => pkg.slug),
  )
    .filter((release) => !isDependencyOnly(release))
    .slice(0, TIMELINE_LIMIT);
  const days = groupByDay(releases);

  return (
    <ChangelogShell
      activeSlug={null}
      latestVersions={latestVersionBySlug(packages)}
      title="Changelog"
      lead={<p>Every release across the hypequery packages and the Python SDK, newest first.</p>}
    >
      <ol className="space-y-12">
        {days.map((day) => (
          <li key={day.day ?? 'undated'} className="relative border-l border-border pl-6 sm:pl-8">
            <span
              aria-hidden="true"
              className="absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-bg bg-accent"
            />
            <h2 className="font-mono text-sm font-medium text-text">
              {day.day ? <time dateTime={day.day}>{formatReleaseDate(day.day)}</time> : 'Earlier releases'}
            </h2>
            <div className="mt-5 space-y-4">
              {day.releases.map((release) => {
                const pkg = changelogPackageBySlug.get(release.packageSlug);
                return pkg ? (
                  <ReleaseEntry
                    key={`${release.packageSlug}@${release.version}`}
                    release={release}
                    pkg={pkg}
                    variant="timeline"
                    maxChanges={TIMELINE_MAX_CHANGES}
                  />
                ) : null;
              })}
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-14 rounded-xl border border-border bg-bg-alt/60 p-6">
        <h2 className="text-lg font-medium tracking-tight text-text">Looking for an older release?</h2>
        <p className="mt-2 text-sm leading-6 text-text-muted">
          This timeline shows the latest {TIMELINE_LIMIT} releases. Each package page has its full history,
          including dependency-only updates.
        </p>
        <ul className="mt-4 flex flex-wrap gap-2">
          {CHANGELOG_PACKAGES.map((pkg) => (
            <li key={pkg.slug}>
              <Link
                href={`/changelog/${pkg.slug}`}
                className="inline-block rounded-lg border border-border bg-bg-card px-3 py-1.5 font-mono text-[13px] text-text-muted transition hover:border-border-strong hover:text-text"
              >
                {packageDisplayName(pkg)}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </ChangelogShell>
  );
}
