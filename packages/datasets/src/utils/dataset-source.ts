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
  const current = currentRowPredicate(ds);
  // Qualified like every base column, so it stays unambiguous once joins are added.
  return current
    ? qb.final().where(`${ds.source}.${current.column}`, 'eq', current.value)
    : qb.final();
}

/**
 * After `FINAL`, the rows that are current state: not deleted in a
 * ReplacingMergeTree, positive in a collapsing engine. `FINAL` alone removes
 * these on current ClickHouse; the filter keeps older servers and unmatched
 * cancel rows from counting. ClickHouse applies it after `FINAL` unless a
 * profile enables `optimize_move_to_prewhere_if_final` (off by default).
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
