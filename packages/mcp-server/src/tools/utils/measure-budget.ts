/**
 * The columns a query spends from its measure budget, counted as the dataset
 * planner counts them (RFC 0026): every selected measure, plus every output
 * column its calculations add. A `compare` entry adds three per measure it
 * compares (`_previous`, `_change`, `_change_pct`); every other kind adds one.
 */
export function measureBudgetUsed(query: {
  readonly measures?: readonly unknown[];
  readonly calculations?: readonly unknown[];
}): number {
  const outputs = (query.calculations ?? []).reduce<number>((total, entry) => {
    const compared = (entry as { compare?: { measures?: readonly unknown[] } } | null)?.compare?.measures;
    return total + (Array.isArray(compared) ? 3 * compared.length : 1);
  }, 0);
  return (query.measures?.length ?? 0) + outputs;
}
