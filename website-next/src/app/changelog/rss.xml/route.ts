import { getChangelog } from '@/lib/changelog/load';
import { CHANGELOG_PACKAGES, changelogPackageBySlug, packageDisplayName } from '@/lib/changelog/packages';
import { releasePath } from '@/lib/changelog/display';
import { buildChangelogFeed } from '@/lib/changelog/feed';
import { isDependencyOnly, sortTimeline } from '@/lib/changelog/timeline';
import { absoluteUrl } from '@/lib/site';

// RSS 2.0 feed of the latest releases across all packages. Dependency-only
// releases are left out, as on the /changelog timeline.

export const revalidate = 3600;

const FEED_LIMIT = 50;

export async function GET() {
  const { packages } = await getChangelog();
  const releases = sortTimeline(
    packages,
    CHANGELOG_PACKAGES.map((pkg) => pkg.slug),
  )
    .filter((release) => !isDependencyOnly(release))
    .slice(0, FEED_LIMIT);

  const xml = buildChangelogFeed(
    {
      title: 'hypequery changelog',
      description: 'Releases of the hypequery TypeScript packages and Python SDK.',
      siteUrl: absoluteUrl('/changelog').toString(),
      feedUrl: absoluteUrl('/changelog/rss.xml').toString(),
    },
    releases.map((release) => {
      const pkg = changelogPackageBySlug.get(release.packageSlug);
      const name = pkg ? packageDisplayName(pkg) : release.packageSlug;
      // absoluteUrl() normalises paths, so append the fragment afterwards.
      const [pathname, fragment] = releasePath(release.packageSlug, release.version).split('#');
      return {
        title: `${name} ${release.version}`,
        url: `${absoluteUrl(pathname).toString()}#${fragment}`,
        publishedAt: release.publishedAt,
        category: name,
        sections: release.sections,
      };
    }),
  );

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
