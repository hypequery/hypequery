import { describe, expect, it } from 'vitest';
import { clearSelections, initialState, rangeEndingAt, toDatasetFilters, toggleSelection } from './filters';

describe('cross-filter state', () => {
  it('builds an inclusive day range ending on the seed\'s last day', () => {
    expect(rangeEndingAt('2026-10-31', 7)).toEqual({ from: '2026-10-25', to: '2026-10-31' });
    expect(initialState.range).toEqual({ from: '2026-10-02', to: '2026-10-31' });
  });

  it('toggles a selection and clears it when clicked again', () => {
    const once = toggleSelection(initialState, 'eventType', 'api_call');
    expect(once.selections).toEqual({ eventType: 'api_call' });
    const twice = toggleSelection(once, 'eventType', 'api_call');
    expect(twice.selections).toEqual({});
    expect(clearSelections(once).selections).toEqual({});
  });

  it('applies every selection except the panel\'s own dimension', () => {
    const state = toggleSelection(toggleSelection(initialState, 'eventType', 'api_call'), 'device', 'mobile');
    expect(toDatasetFilters(state)).toEqual([
      { field: 'occurredAt', operator: 'between', value: ['2026-10-02 00:00:00', '2026-10-31 23:59:59'] },
      { field: 'eventType', operator: 'eq', value: 'api_call' },
      { field: 'device', operator: 'eq', value: 'mobile' },
    ]);
    expect(toDatasetFilters(state, 'eventType').map((f) => f.field)).toEqual(['occurredAt', 'device']);
    expect(toDatasetFilters(state, 'device').map((f) => f.field)).toEqual(['occurredAt', 'eventType']);
  });
});
