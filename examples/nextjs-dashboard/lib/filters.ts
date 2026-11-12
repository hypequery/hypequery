/**
 * Cross-filter state and its translation into dataset filters.
 *
 * Clicking a bar in one panel narrows every other panel. The panel that owns a
 * dimension leaves its own selection out of its query, so the user can still
 * see (and switch to) the other values of that dimension.
 */
export type Dimension = 'eventType' | 'device';

export interface CrossFilterState {
  /** Inclusive day range, `YYYY-MM-DD`. */
  range: { from: string; to: string };
  selections: Partial<Record<Dimension, string>>;
}

/** Filters the panels send; field names are the dataset's dimension names. */
export type DatasetFilter =
  | { field: 'occurredAt'; operator: 'between'; value: [string, string] }
  | { field: Dimension; operator: 'eq'; value: string };

/** The seed's last day. A live app would use today. */
export const SEED_LAST_DAY = '2026-10-31';

export const RANGE_PRESETS = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
] as const;

export function rangeEndingAt(lastDay: string, days: number): CrossFilterState['range'] {
  const end = new Date(`${lastDay}T00:00:00Z`);
  const start = new Date(end.getTime() - (days - 1) * 86_400_000);
  return { from: start.toISOString().slice(0, 10), to: lastDay };
}

export const initialState: CrossFilterState = {
  range: rangeEndingAt(SEED_LAST_DAY, 30),
  selections: {},
};

/** Toggle a value: selecting the active value clears it. */
export function toggleSelection(state: CrossFilterState, dimension: Dimension, value: string): CrossFilterState {
  const selections = { ...state.selections };
  if (selections[dimension] === value) delete selections[dimension];
  else selections[dimension] = value;
  return { ...state, selections };
}

export function clearSelections(state: CrossFilterState): CrossFilterState {
  return { ...state, selections: {} };
}

/**
 * Dataset filters for a panel. `exclude` is the dimension the panel itself
 * breaks down by; its selection is left out so the panel keeps all its bars.
 */
export function toDatasetFilters(state: CrossFilterState, exclude?: Dimension): DatasetFilter[] {
  const filters: DatasetFilter[] = [
    { field: 'occurredAt', operator: 'between', value: [`${state.range.from} 00:00:00`, `${state.range.to} 23:59:59`] },
  ];
  for (const [dimension, value] of Object.entries(state.selections) as Array<[Dimension, string]>) {
    if (dimension !== exclude && value) filters.push({ field: dimension, operator: 'eq', value });
  }
  return filters;
}
