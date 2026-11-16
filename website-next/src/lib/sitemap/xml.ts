import type { MetadataRoute } from 'next';

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function lastmod(value: string | Date | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : `<lastmod>${date.toISOString()}</lastmod>`;
}

function xmlResponse(lines: string[]): Response {
  return new Response(['<?xml version="1.0" encoding="UTF-8"?>', ...lines, ''].join('\n'), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}

/** A `<urlset>` sitemap. */
export function urlsetResponse(entries: MetadataRoute.Sitemap): Response {
  return xmlResponse([
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries.map((entry) => `<url><loc>${escapeXml(entry.url)}</loc>${lastmod(entry.lastModified)}</url>`),
    '</urlset>',
  ]);
}

/** A `<sitemapindex>` pointing at child sitemaps. */
export function sitemapIndexResponse(children: { loc: string; lastModified?: Date }[]): Response {
  return xmlResponse([
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...children.map((child) => `<sitemap><loc>${escapeXml(child.loc)}</loc>${lastmod(child.lastModified)}</sitemap>`),
    '</sitemapindex>',
  ]);
}
