/**
 * The comparisons a query spends from its filter budget, counted as the
 * dataset client counts them (RFC 0029, RFC 0026): every comparison leaf in
 * `filters`, wherever a group nests it, and on a query with calculations its
 * `having` conditions and filter-calculation conditions too. A group costs
 * nothing, so wrapping comparisons in `or` can't buy budget.
 */
export function filterBudgetUsed(query: {
  readonly filters?: readonly unknown[];
  readonly having?: readonly unknown[];
  readonly calculations?: readonly unknown[];
}): number {
  const leaves = comparisonLeaves(query.filters ?? []);
  const calculations = query.calculations ?? [];
  if (calculations.length === 0) return leaves;
  const conditions = calculations.reduce<number>((total, entry) => {
    const where = (entry as { filter?: { where?: readonly unknown[] } } | null)?.filter?.where;
    return total + (Array.isArray(where) ? where.length : 0);
  }, 0);
  return leaves + (query.having?.length ?? 0) + conditions;
}

/** Comparison leaves under `and` / `or` / `not` groups; iterative, so it never recurses. */
function comparisonLeaves(nodes: readonly unknown[]): number {
  const pending = [...nodes];
  let count = 0;
  while (pending.length > 0) {
    const node = pending.pop() as Record<string, unknown> | null;
    if (node === null || typeof node !== 'object') continue;
    if (Array.isArray(node.and)) pending.push(...node.and);
    else if (Array.isArray(node.or)) pending.push(...node.or);
    else if ('not' in node && !('field' in node)) pending.push(node.not);
    else count += 1;
  }
  return count;
}
