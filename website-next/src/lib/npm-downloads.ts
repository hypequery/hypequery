// Server-side npm download counts for the homepage badge. Fetched at render
// time and cached for an hour so the number is in the HTML (crawlers, social
// previews, no loading flash) instead of being fetched from the browser.

export const NPM_BADGE_PACKAGES = ['@hypequery/clickhouse', '@hypequery/datasets'] as const;

export type NpmDownloadCounts = number[] | null;

async function fetchMonthlyDownloads(name: string): Promise<number> {
  const response = await fetch(`https://api.npmjs.org/downloads/point/last-month/${name}`, {
    next: { revalidate: 3600 },
  });
  if (!response.ok) throw new Error(`npm download count unavailable for ${name}`);
  const data: { downloads?: number } = await response.json();
  if (typeof data.downloads !== 'number' || !Number.isFinite(data.downloads) || data.downloads < 0) {
    throw new Error(`Invalid npm download count for ${name}`);
  }
  return data.downloads;
}

/** Monthly downloads for each badge package, in `NPM_BADGE_PACKAGES` order; null if npm is unreachable. */
export async function getNpmDownloadCounts(): Promise<NpmDownloadCounts> {
  try {
    return await Promise.all(NPM_BADGE_PACKAGES.map(fetchMonthlyDownloads));
  } catch {
    return null;
  }
}
