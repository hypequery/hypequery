import type { PostgresSelectNode } from '../types.js';
import { updateSelectNode } from '../query-node.js';

/** Projection, grouping, ordering and pagination. */
export class QueryModifiersFeature {
  constructor(private readonly node: () => PostgresSelectNode) {}

  select(columns: string[] | string): PostgresSelectNode {
    const node = this.node();
    const added = (Array.isArray(columns) ? columns : [columns])
      .map(sql => ({ kind: 'selection' as const, sql, isAggregate: false }));
    return updateSelectNode(node, { select: [...node.select, ...added] });
  }

  groupBy(columns: string | string[]): PostgresSelectNode {
    const node = this.node();
    return updateSelectNode(node, { groupBy: [...node.groupBy, ...(Array.isArray(columns) ? columns : [columns])] });
  }

  orderBy(expression: string, direction?: 'ASC' | 'DESC'): PostgresSelectNode {
    const node = this.node();
    return updateSelectNode(node, {
      orderBy: [...node.orderBy, { kind: 'order', expression, ...(direction ? { direction } : {}) }],
    });
  }

  limit(count: number): PostgresSelectNode {
    return updateSelectNode(this.node(), { limit: nonNegativeInteger(count, 'limit') });
  }

  offset(count: number): PostgresSelectNode {
    return updateSelectNode(this.node(), { offset: nonNegativeInteger(count, 'offset') });
  }
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`A ${name} must be a non-negative integer.`);
  return value;
}
