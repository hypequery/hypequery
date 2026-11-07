import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ChangelogShell } from '@/components/changelog/ChangelogShell';
import { DependencyRelease, ReleaseEntry } from '@/components/changelog/ReleaseEntry';
import { getChangelog } from '@/lib/changelog/load';
import { CHANGELOG_PACKAGES, changelogPackageBySlug, packageDisplayName, registryUrl } from '@/lib/changelog/packages';
import { formatReleaseDate, sourceUrl } from '@/lib/changelog/display';
import { isDependencyOnly, latestVersionBySlug } from '@/lib/changelog/timeline';
import { absoluteUrl, ogImage } from '@/lib/site';

export const revalidate = 3600;
export const dynamicParams = false;

export function generateStaticParams() {
  return CHANGELOG_PACKAGES.map((pkg) => ({ slug: pkg.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const pkg = changelogPackageBySlug.get(slug);
  if (!pkg) return {};

  const title = `${packageDisplayName(pkg)} changelog`;
  const description = `Release history for ${packageDisplayName(pkg)}: ${pkg.description}`;
  return {
    title,
    description,
    alternates: { canonical: absoluteUrl(`/changelog/${pkg.slug}`) },
    openGraph: {
      type: 'website',
      url: absoluteUrl(`/changelog/${pkg.slug}`),
      title,
      description,
      images: ogImage(title),
    },
  };
}

export default async function PackageChangelogPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const pkg = changelogPackageBySlug.get(slug);
  if (!pkg) notFound();

  const { packages } = await getChangelog();
  const releases = packages[pkg.slug] ?? [];
  const latest = releases[0];

  return (
    <ChangelogShell
      activeSlug={pkg.slug}
      latestVersions={latestVersionBySlug(packages)}
      title={packageDisplayName(pkg)}
      lead={
        <>
          <p>{pkg.description}</p>
          {latest ? (
            <p className="mt-1 text-sm">
              Latest: <span className="font-mono text-text">{latest.version}</span>
              {latest.publishedAt ? <> · {formatReleaseDate(latest.publishedAt)}</> : null}
              {' · '}
              <a href={registryUrl(pkg)} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-text">
                {pkg.registry === 'npm' ? 'npm' : 'PyPI'}
              </a>
              {' · '}
              <a href={sourceUrl(pkg.changelogPath)} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-text">
                CHANGELOG.md
              </a>
            </p>
          ) : null}
        </>
      }
    >
      <div className="space-y-4">
        {releases.map((release) =>
          isDependencyOnly(release) ? (
            <DependencyRelease key={release.version} release={release} pkg={pkg} />
          ) : (
            <ReleaseEntry key={release.version} release={release} pkg={pkg} variant="package" />
          ),
        )}
      </div>
    </ChangelogShell>
  );
}
