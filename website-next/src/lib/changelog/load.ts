import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { unstable_cache } from 'next/cache';
import { CHANGELOG_PACKAGES, type ChangelogPackage } from './packages';
import { parseChangelog, releaseBump, type ParsedRelease, type ReleaseBump } from './parse';

// Loads every package changelog for /changelog.
//
// Production reads the CHANGELOG.md files from `main` on GitHub, so a release
// shows up on the site within the revalidation window of the "chore: release"
// commit landing, whether or not that commit triggers a website deploy. The
// files in this checkout are the fallback (and the source in `next dev`, so
// local edits preview immediately). Publish times come from the npm registry.
//
// Everything is fetched inside `unstable_cache`, which keeps the multi-MB npm
// documents out of the 2MB-per-entry fetch cache; only the parsed result is
// cached.

const REPOSITORY = 'hypequery/hypequery';
const SOURCE_BRANCH = 'main';
const FETCH_TIMEOUT_MS = 8000;
export const CHANGELOG_REVALIDATE_SECONDS = 3600;

export interface ChangelogRelease extends ParsedRelease {
  packageSlug: string;
  bump: ReleaseBump;
  /** ISO timestamp of the registry publish (or the changelog heading's date). */
  publishedAt?: string;
}

export interface ChangelogData {
  /** Releases per package slug, newest first. */
  packages: Record<string, ChangelogRelease[]>;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${url} responded ${response.status}`);
  return response.text();
}

function readLocal(pkg: ChangelogPackage): Promise<string> {
  // `next build` and `next dev` run from website-next/, one level below the repo root.
  return readFile(path.join(process.cwd(), '..', pkg.changelogPath), 'utf8');
}

async function readChangelogSource(pkg: ChangelogPackage): Promise<string> {
  if (process.env.NODE_ENV === 'development') return readLocal(pkg);
  try {
    return await fetchText(`https://raw.githubusercontent.com/${REPOSITORY}/${SOURCE_BRANCH}/${pkg.changelogPath}`);
  } catch {
    // Throws if neither source is reachable, so a failed revalidation keeps
    // serving the previous page instead of an empty changelog.
    return readLocal(pkg);
  }
}

/** Publish time per version from the npm registry; empty when it is unreachable. */
async function fetchPublishTimes(pkg: ChangelogPackage): Promise<Record<string, string>> {
  if (pkg.registry !== 'npm') return {};
  try {
    const response = await fetch(`https://registry.npmjs.org/${pkg.name}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return {};
    const document: { time?: Record<string, string> } = await response.json();
    return document.time ?? {};
  } catch {
    return {};
  }
}

async function loadPackage(pkg: ChangelogPackage): Promise<ChangelogRelease[]> {
  const [source, publishTimes] = await Promise.all([readChangelogSource(pkg), fetchPublishTimes(pkg)]);
  const releases = parseChangelog(source);

  return releases.map((release, index) => {
    const publishedAt = publishTimes[release.version] ?? (release.date ? `${release.date}T00:00:00.000Z` : undefined);
    return {
      ...release,
      packageSlug: pkg.slug,
      bump: releaseBump(release.version, releases[index + 1]?.version),
      ...(publishedAt ? { publishedAt } : {}),
    };
  });
}

async function loadChangelog(): Promise<ChangelogData> {
  const loaded = await Promise.all(CHANGELOG_PACKAGES.map(loadPackage));
  return {
    packages: Object.fromEntries(CHANGELOG_PACKAGES.map((pkg, index) => [pkg.slug, loaded[index]])),
  };
}

export const getChangelog = unstable_cache(loadChangelog, ['changelog', 'v1'], {
  revalidate: CHANGELOG_REVALIDATE_SECONDS,
  tags: ['changelog'],
});
