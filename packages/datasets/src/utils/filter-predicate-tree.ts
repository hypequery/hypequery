import type { DatasetFilterNode, MetricFilter, MetricFilterOperator } from '../types.js';
import type { QueryBuilderLike } from '../query-builder-protocol.js';
import { isFilterGroup } from './filter-tree.js';

/**
 * Operators a planned comparison may carry. `notLike` exists only here: it is
 * how a negated `like` renders, never something a caller writes (RFC 0029).
 */
export type PlannedFilterOperator = MetricFilterOperator | 'notLike';

/** A comparison after `not` has been pushed down to it. */
export interface PlannedFilter {
  readonly field: string;
  readonly operator: PlannedFilterOperator;
  readonly value?: unknown;
}

/** One `where` call: the column side, its operator, and the value to bind. */
export interface PlannedWherePredicate {
  readonly expression: string;
  readonly operator: PlannedFilterOperator;
  readonly value: unknown;
}

type NormalNode =
  | { readonly kind: 'leaf'; readonly filter: PlannedFilter }
  | { readonly kind: 'and' | 'or'; readonly items: readonly NormalNode[] };

const NEGATED: Partial<Record<PlannedFilterOperator, PlannedFilterOperator>> = {
  eq: 'neq', neq: 'eq', gt: 'lte', gte: 'lt', lt: 'gte', lte: 'gt',
  in: 'notIn', notIn: 'in', isNull: 'isNotNull', isNotNull: 'isNull', like: 'notLike',
};

function negateLeaf(filter: MetricFilter): NormalNode {
  if (filter.operator === 'between') {
    const [low, high] = filter.value as [unknown, unknown];
    return {
      kind: 'or',
      items: [
        { kind: 'leaf', filter: { field: filter.field, operator: 'lt', value: low } },
        { kind: 'leaf', filter: { field: filter.field, operator: 'gt', value: high } },
      ],
    };
  }
  const operator = NEGATED[filter.operator];
  if (!operator) throw new Error(`Filter operator "${filter.operator}" cannot be negated.`);
  return { kind: 'leaf', filter: { ...filter, operator } as PlannedFilter };
}

/**
 * Negation normal form: `not` pushed to the leaves by De Morgan. Each rewrite
 * is exact under SQL three-valued logic, so the rows are those of the
 * authored tree.
 */
function normalize(node: DatasetFilterNode, negated: boolean): NormalNode {
  if (!isFilterGroup(node)) return negated ? negateLeaf(node) : { kind: 'leaf', filter: node };
  if ('not' in node && node.not !== undefined) return normalize(node.not, !negated);
  const isAnd = 'and' in node && node.and !== undefined;
  const items = (isAnd ? node.and : (node as { or: readonly DatasetFilterNode[] }).or)
    .map(item => normalize(item, negated));
  if (items.length === 1) return items[0]!;
  // De Morgan: a negated AND is an OR of the negated items, and vice versa.
  return { kind: isAnd !== negated ? 'and' : 'or', items };
}

type Predicates = (filter: PlannedFilter) => readonly PlannedWherePredicate[];
type GroupBuilder = QueryBuilderLike & Required<Pick<QueryBuilderLike, 'whereGroup' | 'orWhere' | 'orWhereGroup'>>;

function requireGroups(builder: QueryBuilderLike): GroupBuilder {
  if (!builder.whereGroup || !builder.orWhere || !builder.orWhereGroup) {
    throw new Error('Filter groups with "or" or "not" need a query builder with whereGroup, orWhere and orWhereGroup.');
  }
  return builder as GroupBuilder;
}

/** AND the node's predicates onto `builder`. */
function applyAnd(builder: QueryBuilderLike, node: NormalNode, predicates: Predicates): QueryBuilderLike {
  if (node.kind === 'leaf') {
    return predicates(node.filter).reduce(
      (current, predicate) => current.where(predicate.expression, predicate.operator, predicate.value),
      builder,
    );
  }
  if (node.kind === 'and') return node.items.reduce((current, item) => applyAnd(current, item, predicates), builder);
  return requireGroups(builder).whereGroup(group => applyOr(group, node.items, predicates));
}

/** OR the items together inside an open group. */
function applyOr(builder: QueryBuilderLike, items: readonly NormalNode[], predicates: Predicates): QueryBuilderLike {
  return items.reduce((current, item, index) => {
    const groups = requireGroups(current);
    const leafPredicates = item.kind === 'leaf' ? predicates(item.filter) : undefined;
    if (leafPredicates?.length === 1) {
      const [predicate] = leafPredicates as [PlannedWherePredicate];
      return index === 0
        ? groups.where(predicate.expression, predicate.operator, predicate.value)
        : groups.orWhere(predicate.expression, predicate.operator, predicate.value);
    }
    // A multi-predicate leaf, or a nested AND/OR, is one parenthesized alternative.
    const nested = (inner: QueryBuilderLike) => (item.kind === 'or'
      ? applyOr(inner, item.items, predicates)
      : applyAnd(inner, item, predicates));
    return index === 0 ? groups.whereGroup(nested) : groups.orWhereGroup(nested);
  }, builder);
}

/**
 * Apply caller filters to `builder`. A flat list makes exactly the `where`
 * calls it always has, so its SQL is unchanged; groups use the builder's
 * group methods and fail loudly on a builder without them.
 */
export function applyFilterTree(
  builder: QueryBuilderLike,
  nodes: readonly DatasetFilterNode[] | undefined,
  predicates: Predicates,
): QueryBuilderLike {
  return (nodes ?? []).reduce(
    (current, node) => applyAnd(current, normalize(node, false), predicates),
    builder,
  );
}
