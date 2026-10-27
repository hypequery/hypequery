import type { ExplainStatement } from './run-check.js';

/** A connected node-postgres client, as the introspector uses it. */
export interface PostgresExplainClient {
  query<R>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
}

/** A sequential scan over at least this many rows (planner statistics) gets an index hint. */
export const LARGE_TABLE_ROWS = 100_000;

interface PlanNode {
  readonly 'Node Type'?: string;
  readonly 'Relation Name'?: string;
  readonly Schema?: string;
  readonly Filter?: string;
  readonly Plans?: readonly PlanNode[];
}

/**
 * Plan a statement on Postgres with `EXPLAIN`, which never runs it. Warns
 * when a large table is read by a filtered sequential scan: the query
 * narrows the rows (a tenant predicate, a time window) but still reads them
 * all, which an index on the filtered key usually avoids. An unfiltered
 * aggregate reads every row whatever the indexes, so it isn't flagged.
 */
export function postgresExplainer(client: PostgresExplainClient): ExplainStatement {
  const tableRows = new Map<string, number>();
  return async ({ sql, parameters }) => {
    const { rows } = await client.query<{ 'QUERY PLAN': readonly { readonly Plan: PlanNode }[] }>(
      `EXPLAIN (FORMAT JSON, VERBOSE) ${sql}`,
      [...parameters],
    );
    const warnings: string[] = [];
    for (const relation of sequentialScans(rows[0]?.['QUERY PLAN']?.[0]?.Plan)) {
      if (!tableRows.has(relation)) {
        const { rows: stats } = await client.query<{ rows: number | null }>(
          'SELECT reltuples::float8 AS rows FROM pg_class WHERE oid = to_regclass($1)',
          [relation],
        );
        tableRows.set(relation, Math.max(0, stats[0]?.rows ?? 0));
      }
      const estimated = tableRows.get(relation)!;
      if (estimated >= LARGE_TABLE_ROWS) {
        warnings.push(`filtered sequential scan of ${relation} (~${Math.round(estimated).toLocaleString('en-US')} rows); `
          + 'an index on its tenant or time key may avoid it');
      }
    }
    return warnings;
  };
}

/** Quoted `schema.table` names of every filtered sequential scan in a plan. */
function sequentialScans(node: PlanNode | undefined, found: Set<string> = new Set()): Set<string> {
  if (!node) return found;
  if (node['Node Type'] === 'Seq Scan' && node['Relation Name'] && node.Filter) {
    const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;
    found.add(`${node.Schema ? `${quote(node.Schema)}.` : ''}${quote(node['Relation Name'])}`);
  }
  for (const child of node.Plans ?? []) sequentialScans(child, found);
  return found;
}

/** The subset of `@clickhouse/client` the ClickHouse planner uses. */
export interface ClickHouseExplainClient {
  query(params: { query: string; format: 'JSONEachRow' }): Promise<{ json(): Promise<unknown> }>;
}

/**
 * Plan a statement on ClickHouse with `EXPLAIN`, which resolves every column
 * and function without reading data. *substitute* is the project's
 * `@hypequery/clickhouse` `substituteParameters`, which binds values exactly
 * as the query builder does.
 */
export function clickhouseExplainer(
  client: ClickHouseExplainClient,
  substitute: (sql: string, parameters: unknown[]) => string,
): ExplainStatement {
  return async ({ sql, parameters }) => {
    const result = await client.query({ query: `EXPLAIN ${substitute(sql, [...parameters])}`, format: 'JSONEachRow' });
    await result.json();
    return [];
  };
}
