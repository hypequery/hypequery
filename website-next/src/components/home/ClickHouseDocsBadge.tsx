// ClickHouse lists hypequery as a community integration in its docs (added 2026-11-18).
// Text only: no ClickHouse logo until we have confirmed we may use it here.
export const CLICKHOUSE_DOCS_LISTING_URL =
  'https://clickhouse.com/docs/integrations/connectors/data-visualization/community-integrations/hypequery-and-clickhouse';

/** The "Listed in the ClickHouse docs" badge, shown beside the other homepage proof badges. */
export function ClickHouseDocsBadge() {
  return (
    <a href={CLICKHOUSE_DOCS_LISTING_URL} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-2 rounded-lg border border-border-strong bg-bg-card px-3 font-mono text-xs text-text-muted transition hover:-translate-y-px hover:border-text focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent">
      <span className="font-semibold text-text">Listed in</span><span className="border-l border-border pl-2">ClickHouse docs</span>
    </a>
  );
}
