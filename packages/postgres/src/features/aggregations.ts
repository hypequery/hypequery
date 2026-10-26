import type { PostgresSelectNode } from '../types.js';
import { updateSelectNode } from '../query-node.js';

/** Aggregate selections, spelled for Postgres to match the ClickHouse results. */
export class AggregationFeature {
  constructor(private readonly node: () => PostgresSelectNode) {}

  sum(column: string, alias?: string) {
    return this.append(`SUM(${column})`, alias ?? `${column}_sum`);
  }

  count(column: string, alias?: string) {
    return this.append(`COUNT(${column})`, alias ?? `${column}_count`);
  }

  countDistinct(column: string, alias?: string) {
    return this.append(`COUNT(DISTINCT ${column})`, alias ?? `${column}_countDistinct`);
  }

  avg(column: string, alias?: string) {
    return this.append(`AVG(${column})`, alias ?? `${column}_avg`);
  }

  min(column: string, alias?: string) {
    return this.append(`MIN(${column})`, alias ?? `${column}_min`);
  }

  max(column: string, alias?: string) {
    return this.append(`MAX(${column})`, alias ?? `${column}_max`);
  }

  /** ClickHouse `argMax`: the value on the row whose `argColumn` is greatest, ignoring NULL args. */
  argMax(column: string, argColumn: string, alias?: string) {
    return this.append(
      `(ARRAY_AGG(${column} ORDER BY ${argColumn} DESC) FILTER (WHERE ${argColumn} IS NOT NULL))[1]`,
      alias ?? `${column}_argMax`,
    );
  }

  argMin(column: string, argColumn: string, alias?: string) {
    return this.append(
      `(ARRAY_AGG(${column} ORDER BY ${argColumn} ASC) FILTER (WHERE ${argColumn} IS NOT NULL))[1]`,
      alias ?? `${column}_argMin`,
    );
  }

  /** Interpolated percentile; ClickHouse `quantile` is an approximation of the same value. */
  quantile(column: string, level: number, alias?: string) {
    if (!Number.isFinite(level) || level < 0 || level > 1) {
      throw new Error('A quantile level must be a number in [0, 1].');
    }
    return this.append(`percentile_cont(${level}) WITHIN GROUP (ORDER BY ${column})`, alias ?? `${column}_quantile`);
  }

  stddev(column: string, alias?: string) {
    return this.append(`stddev_samp(${column})`, alias ?? `${column}_stddev`);
  }

  variance(column: string, alias?: string) {
    return this.append(`var_samp(${column})`, alias ?? `${column}_variance`);
  }

  /** Postgres has no sketch aggregate built in; the exact count is a correct estimate. */
  approxCountDistinct(column: string, alias?: string) {
    return this.countDistinct(column, alias ?? `${column}_approxCountDistinct`);
  }

  private append(expression: string, alias: string): PostgresSelectNode {
    const node = this.node();
    return updateSelectNode(node, {
      select: [...node.select, { kind: 'selection', sql: `${expression} AS ${alias}`, isAggregate: true }],
    });
  }
}
