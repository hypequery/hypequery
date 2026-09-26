/**
 * Verifies declared to-one relationships against the data.
 *
 * `belongsTo` and `hasOne` are declarations: nothing at query time proves the
 * target join column is unique. Relationship joins are single-match, so a
 * duplicate key cannot inflate an aggregate, but the join then takes an
 * arbitrary one of the matching rows and grouped values drift without any
 * error. `checkRelationships` counts rows and distinct keys on each target so a
 * mis-declaration is caught in CI or at deploy time rather than in a report.
 *
 * @example
 * ```ts
 * const result = await checkRelationships(Orders, { queryBuilder: db });
 * if (!result.ok) {
 *   throw new Error(result.issues.map((issue) => issue.message).join('\n'));
 * }
 * ```
 */

import type { AnyDatasetInstance, ExecutionContext } from './types.js';
import { toQueryBuilderFactory, type QueryBuilderFactoryInput } from './query-builder-protocol.js';
import { getRuntimeTenantPredicate, validateTenantRuntime } from './utils/tenant-runtime.js';
import {
  listToOneRelationships,
  readCount,
  relationshipKeyIssue,
  type RelationshipKeyIssue,
} from './utils/relationship-key-check.js';

export type { RelationshipKeyIssue } from './utils/relationship-key-check.js';

export interface CheckRelationshipsOptions {
  /** Query builder factory used to count target keys. */
  queryBuilder: QueryBuilderFactoryInput;
  /**
   * Runtime context. A tenant-scoped target is checked within the runtime
   * tenant, the same scope its join uses, so it requires tenant runtime.
   */
  context?: ExecutionContext;
  /** Restrict the check to these to-one relationship names. */
  relationships?: readonly string[];
}

export interface CheckRelationshipsResult {
  /** True when every checked relationship has a unique target key. */
  ok: boolean;
  /** Relationship names that were checked. */
  checked: string[];
  issues: RelationshipKeyIssue[];
}

const ROWS_ALIAS = '__hq_rows';
const KEYS_ALIAS = '__hq_keys';

/**
 * Checks that the target join column of each `belongsTo` and `hasOne`
 * relationship on `ds` is unique. NULL keys are ignored because they never
 * match a join. `hasMany` relationships are skipped.
 */
export async function checkRelationships(
  ds: AnyDatasetInstance,
  options: CheckRelationshipsOptions,
): Promise<CheckRelationshipsResult> {
  const factory = toQueryBuilderFactory(options.queryBuilder);
  const tenantPredicate = getRuntimeTenantPredicate(options.context);
  const entries = listToOneRelationships(ds, options.relationships);
  const issues: RelationshipKeyIssue[] = [];

  for (const entry of entries) {
    const tenantError = validateTenantRuntime(entry.target, options.context);
    if (tenantError) {
      throw new Error(`Cannot check relationship "${entry.relationship}": ${tenantError}`);
    }

    let qb = factory
      .table(entry.target.source)
      .count(entry.column, ROWS_ALIAS)
      .countDistinct(entry.column, KEYS_ALIAS);
    if (entry.target.tenantKey && tenantPredicate) {
      qb = qb.where(entry.target.tenantKey, tenantPredicate.operator, tenantPredicate.value);
    }

    const [row] = await qb.execute<Record<string, unknown>>({
      abortSignal: options.context?.abortSignal,
    });
    const issue = relationshipKeyIssue(entry, readCount(row?.[ROWS_ALIAS]), readCount(row?.[KEYS_ALIAS]));
    if (issue) {
      issues.push(issue);
    }
  }

  return {
    ok: issues.length === 0,
    checked: entries.map((entry) => entry.relationship),
    issues,
  };
}
