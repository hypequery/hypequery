import { notFound } from 'next/navigation';
import { isSitemapSection, sitemapSection, SITEMAP_SECTIONS } from '@/lib/sitemap/sections';
import { urlsetResponse } from '@/lib/sitemap/xml';

// One sitemap per page type, at /sitemap/<section>.xml. /sitemap.xml is the index.
export const dynamic = 'force-static';
export const dynamicParams = false;

export function generateStaticParams() {
  return SITEMAP_SECTIONS.map((id) => ({ file: `${id}.xml` }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const id = file.replace(/\.xml$/, '');
  if (!file.endsWith('.xml') || !isSitemapSection(id)) notFound();
  return urlsetResponse(await sitemapSection(id));
}
