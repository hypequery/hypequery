import type { AnyDatasetInstance } from '../types.js';
import type { QueryBuilderFactoryLike, QueryBuilderLike } from '../query-builder-protocol.js';
import type { RelationshipBuilderContext } from './relationship-builder-plan.js';

/**
 * The dataset's source table as a builder, read with `FINAL` when the dataset
 * declares `rowResolution`. Every builder-path read of a dataset source goes
 * through here so no query can skip row-version resolution.
 */
export function datasetSourceBuilder(
  builderFactory: Pick<QueryBuilderFactoryLike, 'table'>,
  ds: Pick<AnyDatasetInstance, 'name' | 'source' | 'rowResolution'>,
): QueryBuilderLike {
  const qb = builderFactory.table(ds.source);
  if (!ds.rowResolution) {
    return qb;
  }
  if (typeof qb.final !== 'function') {
    throw new Error(
      `Dataset "${ds.name}" reads its source with FINAL, but the query builder does not implement final(). ` +
      'Reading it without FINAL would count every unmerged row version, so the query is refused.',
    );
  }
  const resolved = qb.final();
  const safe = resolved.settings ? resolved.settings(FINAL_SAFETY_SETTINGS) : resolved;
  const current = currentRowPredicate(ds);
  // Qualified like every base column, so it stays unambiguous once joins are added.
  return current ? safe.where(`${ds.source}.${current.column}`, 'eq', current.value) : safe;
}

/**
 * A filter moved to PREWHERE runs before `FINAL` and can match an older version
 * of a row. The server default forbids that; pinning it also covers profiles
 * that enable it. `readonly = 1` accepts a setting equal to the profile's and
 * refuses it exactly where the profile is unsafe, so the query fails closed.
 */
export const FINAL_SAFETY_SETTINGS = { optimize_move_to_prewhere_if_final: 0 } as const;

/**
 * Whether a query reads a source with `FINAL`: the dataset's own, or a
 * relationship target it actually joins. Unused relationships don't count, so
 * a plain query never carries the pin.
 */
export function queryReadsFinal(
  ds: Pick<AnyDatasetInstance, 'rowResolution'>,
  joinCtx: Pick<RelationshipBuilderContext, 'joins'> | undefined,
): boolean {
  return Boolean(ds.rowResolution) || Boolean(joinCtx?.joins.some(join => join.final));
}

/**
 * The statement with `FINAL_SAFETY_SETTINGS` in its own SQL, for paths that run
 * rendered SQL (`rawQuery`), where builder settings don't travel.
 */
export function withFinalSafety<T extends { sql: string }>(readsFinal: boolean, statement: T): T {
  if (!readsFinal) return statement;
  const pins = Object.entries(FINAL_SAFETY_SETTINGS).map(([name, value]) => `${name} = ${value}`);
  return { ...statement, sql: `${statement.sql} SETTINGS ${pins.join(', ')}` };
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
  if (!policy || !('engine' in policy)) return undefined;
  if (policy.engine === 'replacing')
    return policy.deletedColumn === undefined ? undefined : { column: policy.deletedColumn, value: 0 };
  return { column: policy.signColumn, value: 1 };
}
