import type { PostgresSelectNode } from './types.js';

export function createSelectNode(from: string): PostgresSelectNode {
  return {
    kind: 'select-query',
    from,
    select: [],
    joins: [],
    where: [],
    groupBy: [],
    orderBy: [],
  };
}

/** A shallow copy with `changes` applied; nested arrays are replaced, never mutated. */
export function updateSelectNode(
  node: PostgresSelectNode,
  changes: Partial<Omit<PostgresSelectNode, 'kind'>>,
): PostgresSelectNode {
  return { ...node, ...changes };
}
