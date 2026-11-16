import { absoluteUrl } from '@/lib/site';
import { latest, sitemapSection, SITEMAP_SECTIONS } from '@/lib/sitemap/sections';
import { sitemapIndexResponse } from '@/lib/sitemap/xml';

export const dynamic = 'force-static';

/**
 * The sitemap index robots.txt points at, listing one child sitemap per page
 * type (src/app/sitemap/[file]/route.ts). Each child's `<lastmod>` is the newest
 * page date in it; a child with no dated page omits it.
 */
export async function GET() {
  const children = await Promise.all(
    SITEMAP_SECTIONS.map(async (id) => ({ loc: absoluteUrl(`/sitemap/${id}.xml`).toString(), lastModified: latest(await sitemapSection(id)) })),
  );
  return sitemapIndexResponse(children);
}
