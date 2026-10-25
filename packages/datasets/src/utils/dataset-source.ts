import type { AnyDatasetInstance } from '../types.js';
import type { QueryBuilderFactoryLike, QueryBuilderLike } from '../query-builder-protocol.js';

/**
 * The dataset's source table as a builder, read with `FINAL` when the dataset
 * is declared `final: true`. Every builder-path read of a dataset source goes
 * through here so no query can skip row-version resolution.
 */
export function datasetSourceBuilder(
  builderFactory: Pick<QueryBuilderFactoryLike, 'table'>,
  ds: Pick<AnyDatasetInstance, 'name' | 'source' | 'final'>,
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
  return qb.final();
}
