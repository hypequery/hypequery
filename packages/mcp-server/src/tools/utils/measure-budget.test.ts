import { describe, expect, it } from 'vitest';
import { measureBudgetUsed } from './measure-budget.js';

describe('measureBudgetUsed', () => {
  it('counts selected measures and every calculation output column', () => {
    expect(measureBudgetUsed({})).toBe(0);
    expect(measureBudgetUsed({ measures: ['a', 'b'] })).toBe(2);
    expect(measureBudgetUsed({
      measures: ['revenue', 'orders'],
      calculations: [
        { name: 'r', rank: { measure: 'revenue' } },
        { name: 'vs', compare: { to: 'previousPeriod', measures: ['revenue', 'orders'] } },
      ],
    })).toBe(2 + 1 + 6);
  });
});
