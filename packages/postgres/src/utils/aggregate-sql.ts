/** Postgres spellings of the ClickHouse aggregates datasets exposes. */

/** ClickHouse `argMax` / `argMin`: the value on the row with the greatest / least non-NULL `arg`. */
export function argExtremeSql(value: string, arg: string, direction: 'DESC' | 'ASC'): string {
  return `(ARRAY_AGG(${value} ORDER BY ${arg} ${direction}) FILTER (WHERE ${arg} IS NOT NULL))[1]`;
}

/** Interpolated percentile; ClickHouse `quantile` approximates the same value. */
export function percentileSql(value: string, level: number): string {
  if (!Number.isFinite(level) || level < 0 || level > 1) {
    throw new Error('A quantile level must be a number in [0, 1].');
  }
  return `percentile_cont(${level}) WITHIN GROUP (ORDER BY ${value})`;
}
