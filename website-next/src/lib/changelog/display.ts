// Formatting helpers shared by the changelog pages and feed.

import type { ReleaseBump } from './parse';

/** Fragment id for a release, unique across packages: `serve-0-24-4`. */
export function releaseAnchor(packageSlug: string, version: string): string {
  return `${packageSlug}-${version.replace(/[^0-9A-Za-z]+/g, '-')}`;
}

export function releasePath(packageSlug: string, version: string): string {
  return `/changelog/${packageSlug}#${releaseAnchor(packageSlug, version)}`;
}

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
});

/** `2026-11-05…` → `November 5, 2026` (UTC, so build and runtime agree). */
export function formatReleaseDate(isoDate: string): string {
  const parsed = new Date(isoDate.length === 10 ? `${isoDate}T00:00:00.000Z` : isoDate);
  return Number.isNaN(parsed.getTime()) ? isoDate : DATE_FORMAT.format(parsed);
}

/** `Minor Changes` → `Minor changes`; keeps the rest as written. */
export function sectionLabel(title: string): string {
  if (!title) return '';
  return title.charAt(0).toUpperCase() + title.slice(1).toLowerCase();
}

export const BUMP_LABEL: Record<ReleaseBump, string> = {
  major: 'Major',
  minor: 'Minor',
  patch: 'Patch',
  prerelease: 'Pre-release',
};

export function commitUrl(commit: string): string {
  return `https://github.com/hypequery/hypequery/commit/${commit}`;
}

export function sourceUrl(changelogPath: string): string {
  return `https://github.com/hypequery/hypequery/blob/main/${changelogPath}`;
}

/**
 * Keeps the first `maxChanges` changes across a release's sections, dropping
 * sections left empty, and reports how many changes were cut.
 */
export function truncateSections<S extends { changes: readonly unknown[] }>(
  sections: readonly S[],
  maxChanges = Number.POSITIVE_INFINITY,
): { sections: S[]; hidden: number } {
  const kept: S[] = [];
  let budget = maxChanges;
  let hidden = 0;
  for (const section of sections) {
    const take = Math.max(0, Math.min(budget, section.changes.length));
    budget -= take;
    hidden += section.changes.length - take;
    if (take > 0) kept.push({ ...section, changes: section.changes.slice(0, take) });
  }
  return { sections: kept, hidden };
}
