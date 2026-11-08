import { absoluteUrl } from '@/lib/site';
import { clickhouseFunctions, functionPathSegment } from '@/data/clickhouse-functions';
import { entryHref, examples, recipes, type RegistryEntry } from '@/lib/examples';

/**
 * Shared builders for the llms.txt family: the root index plus one sub-index
 * per content type, so the root stays under ~200 entries as the registry
 * grows. Links point at Markdown twins where they exist.
 */
export interface LlmsEntry {
  title: string;
  url: string;
  description?: string;
}

export function formatEntries(entries: LlmsEntry[]): string[] {
  return entries.map((e) => `- [${e.title}](${e.url})${e.description ? `: ${e.description}` : ''}`);
}

export function textResponse(lines: string[]): Response {
  return new Response(`${lines.join('\n').trim()}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

function twinUrl(entry: RegistryEntry): string {
  return absoluteUrl(`${entryHref(entry)}.md`).toString();
}

export function exampleEntries(): LlmsEntry[] {
  return examples.map((e) => ({ title: e.manifest.title, url: twinUrl(e), description: e.manifest.outcome }));
}

export function recipeEntries(): LlmsEntry[] {
  return recipes.map((e) => ({ title: e.manifest.title, url: twinUrl(e), description: e.manifest.outcome }));
}

/** Long-form guides. The materialized view guide lives in the blog and must keep its URL. */
export function guideEntries(): LlmsEntry[] {
  return [
    {
      title: 'A guide to materialized views in ClickHouse',
      url: absoluteUrl('/blog/a-guide-to-materialized-views-in-clickhouse.md').toString(),
      description: 'Incremental vs refreshable views, TO tables, engines, POPULATE pitfalls, projections, and how to query them with hypequery.',
    },
  ];
}

export function functionEntries(): LlmsEntry[] {
  return clickhouseFunctions.map((fn) => ({
    title: fn.name,
    url: absoluteUrl(`/clickhouse/functions/${functionPathSegment(fn.name)}`).toString(),
    description: fn.tagline,
  }));
}

export function subIndex(title: string, intro: string, entries: LlmsEntry[], emptyCopy: string): Response {
  const lines = [`# hypequery ${title}`, '', `> ${intro}`, '', `Root index: ${absoluteUrl('/llms.txt').toString()}`, ''];
  lines.push(...(entries.length > 0 ? formatEntries(entries) : [emptyCopy]));
  return textResponse(lines);
}
