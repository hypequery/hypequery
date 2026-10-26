/**
 * The query node a {@link PostgresQueryBuilder} carries. Every builder method
 * returns a new builder over a new node; nodes are never mutated.
 */

/** A projected expression, as the datasets planner spells it (`expr AS "alias"`). */
export interface SelectionNode {
  readonly kind: 'selection';
  readonly sql: string;
  readonly isAggregate: boolean;
}

export type PostgresFilterOperator =
  | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'
  | 'in' | 'notIn' | 'like' | 'between'
  | 'isNull' | 'isNotNull';

/** A `column <operator> value` predicate whose value is bound, never inlined. */
export interface ConditionNode {
  readonly kind: 'condition';
  readonly column: string;
  readonly operator: PostgresFilterOperator;
  readonly value: unknown;
  /** Wraps each bound value's placeholder, e.g. to convert it to the column's type. */
  readonly convert?: (placeholder: string) => string;
}

/**
 * `LEFT JOIN` or the single-match `LEFT JOIN LATERAL (… LIMIT 1)` that stands
 * in for ClickHouse `LEFT ANY JOIN`.
 */
export interface JoinNode {
  readonly kind: 'join';
  readonly strategy: 'left' | 'left-single-match';
  /** A table name or a parenthesised subquery, inserted verbatim. */
  readonly source: string;
  readonly alias?: string;
  /** `[left, right]` column pairs, ANDed. */
  readonly keys: readonly (readonly [string, string])[];
  readonly conditions: readonly ConditionNode[];
}

export interface OrderNode {
  readonly kind: 'order';
  readonly expression: string;
  readonly direction?: 'ASC' | 'DESC';
}

export interface PostgresSelectNode {
  readonly kind: 'select-query';
  /** Table name or subquery, inserted verbatim. */
  readonly from: string;
  readonly select: readonly SelectionNode[];
  readonly joins: readonly JoinNode[];
  readonly where: readonly ConditionNode[];
  readonly groupBy: readonly string[];
  readonly orderBy: readonly OrderNode[];
  readonly limit?: number;
  readonly offset?: number;
}

/** Spell the placeholder for one bound value and return it. */
export type PlaceholderWriter = (value: unknown) => string;
