import type { AnyDatasetInstance } from '../types.js';
import type { QueryBuilderFactoryLike, QueryBuilderLike } from '../query-builder-protocol.js';

/**
 * The dataset's source table as a builder, read with `FINAL` when the dataset
 * is declared `final: true`. Every builder-path read of a dataset source goes
 * through here so no query can skip row-version resolution.
 */
export function datasetSourceBuilder(
  builderFactory: Pick<QueryBuilderFactoryLike, 'table'>,
  ds: Pick<AnyDatasetInstance, 'name' | 'source' | 'final' | 'rowResolution'>,
): QueryBuilderLike {
  const qb = builderFactory.table(ds.source);
  if (!ds.final) {
    return qb;
  }
  if (typeof qb.final !== 'function') {
    throw new Error(
      `Dataset "${ds.name}" is declared final: true, but the query builder does not implement final(). ` +
      'Reading it without FINAL would count every unmerged row version, so the query is refused.',
    );
  }
  // A filter moved to PREWHERE runs before FINAL and can match an older version
  // of a row. The default already forbids that; pinning it also covers profiles
  // that enable it. readonly = 1 accepts a setting equal to the profile's, and
  // refuses it exactly where the profile is unsafe, so the query fails closed.
  const resolved = qb.final();
  const safe = resolved.settings ? resolved.settings({ optimize_move_to_prewhere_if_final: 0 }) : resolved;
  const current = currentRowPredicate(ds);
  // Qualified like every base column, so it stays unambiguous once joins are added.
  return current ? safe.where(`${ds.source}.${current.column}`, 'eq', current.value) : safe;
}

/**
 * After `FINAL`, the rows that are current state: not deleted in a
 * ReplacingMergeTree, positive in a collapsing engine. `FINAL` alone removes
 * engine-declared deletions on current ClickHouse; the filter covers deletion
 * columns the engine doesn't declare, older servers and unmatched cancel rows.
 */
export function currentRowPredicate(
  ds: Pick<AnyDatasetInstance, 'rowResolution'>,
): { column: string; value: 0 | 1 } | undefined {
  const policy = ds.rowResolution;
  if (!policy) return undefined;
  if (policy.engine === 'replacing')
    return policy.deletedColumn === undefined ? undefined : { column: policy.deletedColumn, value: 0 };
  return { column: policy.signColumn, value: 1 };
}
