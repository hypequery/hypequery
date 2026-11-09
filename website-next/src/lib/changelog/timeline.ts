// Cross-package ordering for the /changelog timeline and feed.

/** The fields the timeline needs; satisfied by `ChangelogRelease`. */
export interface TimelineRelease {
  packageSlug: string;
  version: string;
  publishedAt?: string;
  sections: readonly unknown[];
}

export interface TimelineDay<T extends TimelineRelease> {
  /** YYYY-MM-DD in UTC, or null for releases without a known date. */
  day: string | null;
  releases: T[];
}

/** True for releases whose only content is Changesets' "Updated dependencies" bump. */
export function isDependencyOnly(release: TimelineRelease): boolean {
  return release.sections.length === 0;
}

/**
 * Releases from every package, newest first. Same-instant releases (one
 * Changesets publish) keep package order; undated releases go last.
 */
export function sortTimeline<T extends TimelineRelease>(
  packages: Record<string, readonly T[]>,
  packageOrder: readonly string[],
): T[] {
  const rank = new Map(packageOrder.map((slug, index) => [slug, index]));
  const releases = packageOrder.flatMap((slug) =>
    (packages[slug] ?? []).map((release, position) => ({ release, position })),
  );

  return releases
    .sort((a, b) => {
      const aTime = a.release.publishedAt ? Date.parse(a.release.publishedAt) : -Infinity;
      const bTime = b.release.publishedAt ? Date.parse(b.release.publishedAt) : -Infinity;
      if (aTime !== bTime) return bTime - aTime;
      const byPackage = (rank.get(a.release.packageSlug) ?? 0) - (rank.get(b.release.packageSlug) ?? 0);
      return byPackage || a.position - b.position;
    })
    .map(({ release }) => release);
}

/** Groups an already-sorted list into consecutive UTC days. */
export function groupByDay<T extends TimelineRelease>(releases: readonly T[]): TimelineDay<T>[] {
  const days: TimelineDay<T>[] = [];
  for (const release of releases) {
    const day = release.publishedAt ? release.publishedAt.slice(0, 10) : null;
    const last = days.at(-1);
    if (last && last.day === day) last.releases.push(release);
    else days.push({ day, releases: [release] });
  }
  return days;
}

/** Newest version per package slug, for the package filter. */
export function latestVersionBySlug(
  packages: Record<string, readonly { version: string }[]>,
): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(packages).map(([slug, releases]) => [slug, releases[0]?.version]));
}
