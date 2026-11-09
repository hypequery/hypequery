import { hubs, type Hub, type HubKey } from '@/data/hubs';

// Front matter tags, lowercased, mapped to the hub a post belongs to.
// The first tag that matches in TAG_PRIORITY wins, so a post tagged both
// "TypeScript" and "Semantic layer" is filed under the semantic layer.
const TAG_PRIORITY: Array<[tag: string, hub: HubKey]> = [
  ['embedded analytics', 'embeddedAnalytics'],
  ['semantic layer', 'semanticLayer'],
  ['ai agents', 'semanticLayer'],
  ['mcp', 'semanticLayer'],
  ['typescript', 'clickhouse'],
  ['python', 'clickhouse'],
  ['clickhouse', 'clickhouse'],
];

/** The hub a blog post links up to. Every post is about ClickHouse, so untagged posts go to the ClickHouse hub. */
export function hubForPost(tags: readonly string[] | undefined): Hub {
  const normalized = new Set((tags ?? []).map((tag) => tag.trim().toLowerCase()));
  const match = TAG_PRIORITY.find(([tag]) => normalized.has(tag));
  return hubs[match ? match[1] : 'clickhouse'];
}
