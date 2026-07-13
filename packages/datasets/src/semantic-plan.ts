/**
 * Database-neutral semantic plan protocol (`PlanNode` / `SemanticBackend`).
 *
 * FROZEN: this execution path is superseded by the query-builder path —
 * `createDatasetClient({ queryBuilder })` is the canonical way to execute
 * semantic queries. The plan/backend protocol receives bug fixes only; new
 * semantic features land on the query-builder path and are not guaranteed to
 * be mirrored here.
 */

import type {
  AggregationType,
  FieldType,
  MetricFilter,
  MetricOrderBy,
  TimeGrain,
} from './types.js';

export type SemanticBinaryOperator = 'add' | 'subtract' | 'multiply' | 'divide';
export type SemanticFunctionName = 'nullIfZero' | 'coalesce' | 'round' | 'floor' | 'ceil';

/** @deprecated Part of the frozen plan/backend protocol; use `createDatasetClient({ queryBuilder })` instead. */
export type SemanticExpression =
  | { kind: 'ref'; name: string }
  | { kind: 'literal'; value: string | number | boolean | null }
  | {
    kind: 'binary';
    operator: SemanticBinaryOperator;
    left: SemanticExpression;
    right: SemanticExpression;
  }
  | {
    kind: 'function';
    name: SemanticFunctionName;
    args: SemanticExpression[];
  };

/** @deprecated Part of the frozen plan/backend protocol; use `createDatasetClient({ queryBuilder })` instead. */
export interface SemanticDimensionPlan {
  name: string;
  field: string;
  fieldType?: FieldType;
}

/** @deprecated Part of the frozen plan/backend protocol; use `createDatasetClient({ queryBuilder })` instead. */
export interface SemanticAggregationPlan {
  name: string;
  aggregation: AggregationType;
  field: string;
  /** Resolved second column for argMax/argMin. */
  argField?: string;
  /** Percentile level in [0, 1]; present when aggregation is 'percentile'. */
  level?: number;
  filters?: MetricFilter[];
}

export type SemanticTenantPredicate =
  | { field: string; operator: 'eq'; value: string }
  | { field: string; operator: 'in'; value: string[] };

/**
 * A query-time LEFT JOIN for a to-one relationship. `relationship` is the alias
 * used to qualify joined columns (`<relationship>.<column>`); `from`/`to` are
 * the unqualified base and target join columns. An optional `tenant` predicate
 * scopes the joined target when runtime tenancy is active on the target.
 */
export interface SemanticJoinPlan {
  relationship: string;
  source: string;
  from: string;
  to: string;
  type: 'left';
  tenant?: SemanticTenantPredicate;
}

/** @deprecated Part of the frozen plan/backend protocol; use `createDatasetClient({ queryBuilder })` instead. */
export interface SemanticGrainPlan {
  field: string;
  unit: TimeGrain;
  output: 'period';
  timezone?: string;
  weekStart?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

/** @deprecated Part of the frozen plan/backend protocol; use `createDatasetClient({ queryBuilder })` instead. */
export type PlanNode =
  | {
    kind: 'aggregate';
    source: string;
    dimensions: SemanticDimensionPlan[];
    aggregations: SemanticAggregationPlan[];
    filters: MetricFilter[];
    grain?: SemanticGrainPlan;
    orderBy?: MetricOrderBy[];
    limit?: number;
    offset?: number;
    tenant?: SemanticTenantPredicate;
    /**
     * To-one relationship LEFT JOINs. When present, joined columns referenced by
     * dimensions/filters are qualified as `<relationship>.<column>`; base columns
     * stay unqualified (SQL backends qualify them with `source` as needed).
     */
    joins?: SemanticJoinPlan[];
  }
  | {
    kind: 'derive';
    input: PlanNode;
    metrics: Array<{ name: string; expression: SemanticExpression }>;
    orderBy?: MetricOrderBy[];
    limit?: number;
    offset?: number;
  };

/** @deprecated Part of the frozen plan/backend protocol; use `createDatasetClient({ queryBuilder })` instead. */
export interface SemanticBackendResult<T = Record<string, unknown>> {
  data: T[];
  meta?: {
    timingMs?: number;
    sql?: string;
    tenant?: string;
  };
}

/**
 * @deprecated The plan/backend execution path is frozen (bug fixes only).
 * Pass a query builder to `createDatasetClient({ queryBuilder })` instead of
 * implementing a backend.
 */
export interface SemanticBackend {
  execute<T = Record<string, unknown>>(plan: PlanNode): Promise<SemanticBackendResult<T>>;
  explain?(plan: PlanNode): Promise<{ sql?: string }>;
}
