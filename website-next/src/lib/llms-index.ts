import { absoluteUrl } from '@/lib/site';
import { clickhouseFunctions, functionPathSegment } from '@/data/clickhouse-functions';
import { entryHref, examples, guides, recipes, type RegistryEntry } from '@/lib/examples';

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

/** Long-form guides: the registry's guides, plus the materialized view pillar, which lives in the blog and keeps its URL. */
export function guideEntries(): LlmsEntry[] {
  return [
    ...guides.map((e) => ({ title: e.manifest.title, url: twinUrl(e), description: e.manifest.outcome })),
    {
      title: 'A guide to materialized views in ClickHouse',
      url: absoluteUrl('/blog/a-guide-to-materialized-views-in-clickhouse.md').toString(),
      description: 'Incremental vs refreshable views, TO tables, engines, POPULATE pitfalls, projections, and how to query them with hypequery.',
    },
    ...BLOG_GUIDES.map(([slug, title, description]) => ({
      title,
      url: absoluteUrl(`/blog/${slug}.md`).toString(),
      description,
    })),
  ];
}

/** Blog posts that answer a general ClickHouse question, so agents find them without crawling the blog. */
const BLOG_GUIDES: ReadonlyArray<readonly [slug: string, title: string, description: string]> = [
  ['chdb-python-tutorial', 'chDB Python tutorial: embedded ClickHouse in Python', 'pip install chdb, then chdb.query(): query Parquet, CSV and pandas with ClickHouse SQL, keep MergeTree tables on disk, and serve metrics.'],
  ['clickhouse-settings-for-application-backends', 'ClickHouse settings for application backends', 'readonly = 1 vs 2, 64-bit integer quoting for JavaScript clients, cancel_http_readonly_queries_on_client_close, and query limits for an API user.'],
  ['clickhouse-datetime-vs-datetime64-time-zones', 'ClickHouse DateTime vs DateTime64 and time zones', 'DateTime stores whole seconds and DateTime64(p) up to nanoseconds; both store a UTC instant, and the time zone only changes parsing and display.'],
  ['clickhouse-projections-vs-materialized-views', 'ClickHouse projections vs materialized views', 'A projection is a hidden copy inside the same table that queries use automatically; a materialized view writes to a separate table you query by name.'],
  ['clickhouse-prewhere-vs-where', 'ClickHouse PREWHERE vs WHERE', 'What PREWHERE does, why ClickHouse moves WHERE conditions to PREWHERE automatically, and when writing it by hand helps.'],
  ['clickhouse-pagination-typescript', 'ClickHouse pagination: cursor (keyset) vs LIMIT OFFSET', 'Why deep OFFSET pages get slower and how to paginate on the sort key instead, with TypeScript code.'],
  ['postgres-mysql-to-clickhouse-sql-equivalents', 'Postgres and MySQL to ClickHouse SQL equivalents', 'GROUP_CONCAT, unnest, date_trunc, CASE and more, mapped to their ClickHouse equivalents and checked on ClickHouse 26.6.'],
  ['clickhouse-mcp-servers-compared', 'Official ClickHouse MCP vs a governed MCP server', 'The official ClickHouse MCP server gives agents a read-only SQL tool; a governed MCP server gives them named metrics. When raw SQL access becomes a problem.'],
  ['managed-clickhouse-services-compared', 'Managed ClickHouse services compared', 'ClickHouse Cloud, Tinybird, Altinity.Cloud, Aiven, Instaclustr, Elestio, Alibaba and Yandex compared on deployment, pricing and fit.'],
  ['embedded-analytics-clickhouse-multi-tenant-dashboards', 'ClickHouse multi-tenant embedded analytics architecture', 'Shared tables, row policies plus app-side tenant scoping, a typed API, quotas and fast dashboards for multi-tenant analytics on ClickHouse.'],
];

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
