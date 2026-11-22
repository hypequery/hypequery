/**
 * Keep the first `limit` breakdown groups of an aggregated relation (RFC
 * 0027): ranked by `sizeColumn` summed over the group's rows (descending),
 * then by the breakdown values (ascending, nulls last). Without a breakdown
 * the relation is returned in `orderBy` order.
 */
export function rankedBreakdownSql(options: {
  readonly relation: string;
  readonly breakdown: readonly string[];
  readonly sizeColumn: string;
  readonly limit: number;
  /** Final ordering terms; `_hq_rank` is available to them. */
  readonly orderBy: readonly string[];
}): string {
  const { relation, breakdown, sizeColumn, limit, orderBy } = options;
  if (breakdown.length === 0) {
    return `SELECT * FROM ${relation}${orderBy.length ? ` ORDER BY ${orderBy.join(', ')}` : ''}`;
  }
  const partition = breakdown.join(', ');
  const valueOrder = breakdown.map(alias => `${alias} ASC NULLS LAST`).join(', ');
  const sized = `SELECT *, sum(${sizeColumn}) OVER (PARTITION BY ${partition}) AS _hq_size FROM ${relation}`;
  const ranked = `SELECT *, dense_rank() OVER (ORDER BY _hq_size DESC, ${valueOrder}) AS _hq_rank FROM (${sized})`;
  return `SELECT * FROM (${ranked}) WHERE _hq_rank <= ${limit} ORDER BY ${orderBy.join(', ')}`;
}
