import type { AnyDatasetInstance, ExecutionContext } from '../types.js';
import type { QueryBuilderFactoryLike, QueryBuilderLike } from '../query-builder-protocol.js';
import type { DatasetSqlDialectRules } from '../dataset-sql-dialect.js';
import { resolveFilterField } from '../query-planner.js';
import { FINAL_SAFETY_SETTINGS, datasetSourceBuilder, queryReadsFinal } from './dataset-source.js';
import { queryTimeFilter } from './query-timezone.js';
import {
  applyRelationshipJoins,
  qualifyBaseColumn,
  type RelationshipBuilderContext,
} from './relationship-builder-plan.js';
import { assertEnforcedConstraints } from './enforced-constraints.js';
import { applyRowScope, datasetRowScope, runtimeConstraints } from './row-scope.js';

export interface ScopedDatasetSourceOptions {
  builderFactory: Pick<QueryBuilderFactoryLike, 'table'>;
  ds: AnyDatasetInstance;
  context?: ExecutionContext;
  joinCtx: RelationshipBuilderContext | undefined;
  dialect: DatasetSqlDialectRules;
  timezone: string | undefined;
}

/**
 * The dataset's source as a builder with every trusted row restriction
 * applied (RFC 0020): `FINAL`, relationship joins scoped by each target's own
 * row scope, the dataset's row scope, and the call's enforced constraints.
 *
 * Every builder-path query shape reads its source through here, so none can
 * read rows the context does not allow. Callers add their own selections,
 * filters and aggregations on top; every predicate here is ANDed with them.
 */
export function scopedDatasetSource(options: ScopedDatasetSourceOptions): QueryBuilderLike {
  const { ds, context, joinCtx, dialect, timezone } = options;
  // Validators report this too; checked here so no path can skip it.
  assertEnforcedConstraints(ds, context);
  let qb = applyRelationshipJoins(datasetSourceBuilder(options.builderFactory, ds), joinCtx);
  // A resolved join target is read with FINAL even when this dataset isn't.
  if (queryReadsFinal(ds, joinCtx) && qb.settings) qb = qb.settings(FINAL_SAFETY_SETTINGS);
  qb = applyRowScope(qb, datasetRowScope(ds, context), column => qualifyBaseColumn(joinCtx, column, ds.source));
  // Constraints are filters in the dataset's vocabulary, applied exactly as a
  // caller filter on the same field would be.
  for (const constraint of runtimeConstraints(context)) {
    const expression = resolveFilterField(ds, constraint.field, joinCtx);
    for (const predicate of queryTimeFilter(dialect, ds, constraint, expression, timezone)) {
      qb = qb.where(predicate.expression, predicate.operator, predicate.value);
    }
  }
  return qb;
}
