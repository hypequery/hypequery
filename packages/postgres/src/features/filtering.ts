import type { PostgresFilterOperator, PostgresSelectNode } from '../types.js';
import { updateSelectNode } from '../query-node.js';

const OPERATORS = new Set<string>(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn', 'like', 'between']);

export function isPostgresFilterOperator(operator: string): operator is PostgresFilterOperator {
  return OPERATORS.has(operator);
}

/** WHERE predicates; values are always bound. */
export class FilteringFeature {
  constructor(private readonly node: () => PostgresSelectNode) {}

  where(column: string, operator: string, value: unknown): PostgresSelectNode {
    if (!isPostgresFilterOperator(operator)) throw new Error(`Unsupported filter operator: ${operator}`);
    const node = this.node();
    return updateSelectNode(node, { where: [...node.where, { kind: 'condition', column, operator, value }] });
  }
}
