import type {
  DatasetFilterGroup,
  DatasetFilterNode,
  MetricFilter,
  MetricFilterOperator,
} from '../types.js';

/**
 * Nested caller filters (RFC 0029): a query's `filters` list is an implicit
 * AND of comparisons and `{ and }` / `{ or }` / `{ not }` groups.
 */

/** Deepest group nesting a query may use, so a hostile tree cannot exhaust the stack. */
export const MAX_FILTER_GROUP_DEPTH = 32;

const GROUP_KEYS = ['and', 'or', 'not'] as const;

/** True for a `{ and }`, `{ or }` or `{ not }` node, as opposed to a comparison. */
export function isFilterGroup(node: unknown): node is DatasetFilterGroup {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) return false;
  if (Object.hasOwn(node, 'field')) return false;
  return GROUP_KEYS.some(key => Object.hasOwn(node, key));
}

/** True when `nodes` holds any group, so the flat, builder-free paths cannot run it. */
export function hasFilterGroups(nodes: readonly DatasetFilterNode[] | undefined): boolean {
  return (nodes ?? []).some(isFilterGroup);
}

function groupItems(group: DatasetFilterGroup): readonly DatasetFilterNode[] {
  if ('not' in group && group.not !== undefined) return [group.not];
  return ('and' in group ? group.and : group.or) ?? [];
}

/** Every comparison in the tree, depth first, as authored. */
export function filterLeaves(nodes: readonly DatasetFilterNode[] | undefined): MetricFilter[] {
  const leaves: MetricFilter[] = [];
  const visit = (node: DatasetFilterNode, depth: number): void => {
    if (!isFilterGroup(node)) {
      // Malformed entries are reported by filterTreeErrors, not read here.
      if (typeof node === 'object' && node !== null && !Array.isArray(node)) leaves.push(node);
      return;
    }
    if (depth > MAX_FILTER_GROUP_DEPTH) return;
    const items = groupItems(node);
    if (Array.isArray(items)) items.forEach(item => visit(item, depth + 1));
  };
  (nodes ?? []).forEach(node => visit(node, 1));
  return leaves;
}

/** Number of comparisons the query applies: what `maxFilters` bounds. */
export function filterLeafCount(nodes: readonly DatasetFilterNode[] | undefined): number {
  return filterLeaves(nodes).length;
}

/**
 * The operator a comparison has once `not` is pushed down to it, as the
 * operator allowlist sees it. `between` negates to a pair; `like` has no
 * portable negation and is checked as itself.
 */
export function negatedFilterOperators(operator: MetricFilterOperator): readonly MetricFilterOperator[] {
  switch (operator) {
    case 'eq': return ['neq'];
    case 'neq': return ['eq'];
    case 'gt': return ['lte'];
    case 'gte': return ['lt'];
    case 'lt': return ['gte'];
    case 'lte': return ['gt'];
    case 'in': return ['notIn'];
    case 'notIn': return ['in'];
    case 'isNull': return ['isNotNull'];
    case 'isNotNull': return ['isNull'];
    case 'between': return ['lt', 'gt'];
    case 'like': return ['like'];
    case 'inDateRange': return ['lt', 'gte'];
    default: return [operator];
  }
}

export interface EffectiveFilterLeaf {
  /** The comparison as authored. */
  readonly filter: MetricFilter;
  /** True under an odd number of `not`s. */
  readonly negated: boolean;
  /** Operators the allowlist must permit for this comparison (RFC 0029). */
  readonly operators: readonly MetricFilterOperator[];
}

/** Every comparison with the operators it effectively applies. */
export function effectiveFilterLeaves(nodes: readonly DatasetFilterNode[] | undefined): EffectiveFilterLeaf[] {
  const leaves: EffectiveFilterLeaf[] = [];
  const visit = (node: DatasetFilterNode, negated: boolean, depth: number): void => {
    if (!isFilterGroup(node)) {
      if (typeof node !== 'object' || node === null || Array.isArray(node)) return;
      leaves.push({
        filter: node,
        negated,
        operators: negated ? negatedFilterOperators(node.operator) : [node.operator],
      });
      return;
    }
    if (depth > MAX_FILTER_GROUP_DEPTH) return;
    const items = groupItems(node);
    if (!Array.isArray(items)) return;
    const flips = 'not' in group(node);
    items.forEach(item => visit(item, flips ? !negated : negated, depth + 1));
  };
  (nodes ?? []).forEach(node => visit(node, false, 1));
  return leaves;
}

function group(node: DatasetFilterGroup): Record<string, unknown> {
  return node as unknown as Record<string, unknown>;
}

/** Structural problems with the groups themselves; leaves are validated separately. */
export function filterTreeErrors(nodes: unknown): string[] {
  if (nodes === undefined) return [];
  if (!Array.isArray(nodes)) return ['Filters must be an array.'];
  const errors: string[] = [];
  const visit = (node: unknown, depth: number): void => {
    if (typeof node !== 'object' || node === null || Array.isArray(node)) {
      errors.push('Each filter must be an object: a comparison, or an and/or/not group.');
      return;
    }
    if (!isFilterGroup(node)) return;
    if (depth > MAX_FILTER_GROUP_DEPTH) {
      errors.push(`Filter groups may nest at most ${MAX_FILTER_GROUP_DEPTH} deep.`);
      return;
    }
    const keys = Object.keys(node);
    if (keys.length !== 1) {
      errors.push('A filter group has exactly one of "and", "or" or "not".');
      return;
    }
    const [key] = keys as ['and' | 'or' | 'not'];
    const value = (node as Record<string, unknown>)[key];
    if (key === 'not') {
      if (Array.isArray(value)) {
        errors.push('A "not" group takes one filter, not an array.');
        return;
      }
      visit(value, depth + 1);
      return;
    }
    if (!Array.isArray(value) || value.length === 0) {
      errors.push(`An "${key}" group needs a non-empty array of filters.`);
      return;
    }
    value.forEach(item => visit(item, depth + 1));
  };
  nodes.forEach(node => visit(node, 1));
  return errors;
}

/**
 * The top-level conjuncts: top-level `and` groups and one-item `or` groups
 * are spliced in, so `[{ and: [a, b] }, c]` reads as `[a, b, c]`. Only these
 * can bound a time axis.
 */
export function topLevelFilterNodes(nodes: readonly DatasetFilterNode[] | undefined): DatasetFilterNode[] {
  const result: DatasetFilterNode[] = [];
  const visit = (node: DatasetFilterNode): void => {
    if (isFilterGroup(node)) {
      const record = group(node);
      if (Array.isArray(record.and) || (Array.isArray(record.or) && record.or.length === 1)) {
        (groupItems(node)).forEach(visit);
        return;
      }
    }
    result.push(node);
  };
  (nodes ?? []).forEach(visit);
  return result;
}

/** Comparisons nested under an `or` or `not`, which filter rows but bound nothing. */
export function nestedFilterLeaves(nodes: readonly DatasetFilterNode[] | undefined): MetricFilter[] {
  return topLevelFilterNodes(nodes).filter(isFilterGroup).flatMap(node => filterLeaves([node]));
}
