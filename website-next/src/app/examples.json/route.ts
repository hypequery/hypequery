import { absoluteUrl } from '@/lib/site';
import { entryHref, packageVersions, registryEntries, REPO_TREE_URL } from '@/lib/examples';

// Static, regenerated at build time.
export const revalidate = false;

/**
 * The machine-readable registry index consumed by `hypequery examples list`
 * and `hypequery create`. Deliberately small: no README or source bodies,
 * those live in the repo and on the pages.
 */
export function GET() {
  const body = {
    version: 1,
    source: { repository: 'hypequery/hypequery', ref: 'main' },
    packageVersions,
    entries: registryEntries.map(({ manifest, dir }) => ({
      slug: manifest.slug,
      kind: manifest.kind,
      title: manifest.title,
      outcome: manifest.outcome,
      dir,
      url: absoluteUrl(entryHref({ manifest })).toString(),
      markdown: absoluteUrl(`${entryHref({ manifest })}.md`).toString(),
      source: `${REPO_TREE_URL}/${dir}`,
      packages: manifest.packages,
      keywords: manifest.keywords,
      ...(manifest.kind === 'guide'
        ? { clickhouseVersion: manifest.clickhouseVersion }
        : {
            language: manifest.language,
            stack: manifest.stack,
            useCases: manifest.useCases,
            run: manifest.run,
            env: manifest.env,
            exampleRequest: manifest.exampleRequest ?? null,
            minVersion: manifest.minVersion,
          }),
    })),
  };
  return new Response(`${JSON.stringify(body, null, 2)}\n`, {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
  });
}
