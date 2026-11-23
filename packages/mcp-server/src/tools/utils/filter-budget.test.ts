import { describe, expect, it } from 'vitest';
import { filterBudgetUsed } from './filter-budget.js';

const eq = (field: string) => ({ field, operator: 'eq', value: 'x' });

describe('filterBudgetUsed', () => {
  it('counts comparison leaves, wherever groups nest them', () => {
    expect(filterBudgetUsed({})).toBe(0);
    expect(filterBudgetUsed({ filters: [eq('a'), { and: [eq('b'), { or: [eq('c'), { not: eq('d') }] }] }] })).toBe(4);
    expect(filterBudgetUsed({ filters: [{ field: 'not', operator: 'isNull' }] })).toBe(1);
    expect(filterBudgetUsed({ filters: [null, 'x'] })).toBe(0);
  });

  it('adds having and filter-calculation conditions only when the query has calculations', () => {
    const having = [{ measure: 'm', operator: 'gt', value: 1 }];
    expect(filterBudgetUsed({ filters: [eq('a')], having })).toBe(1);
    expect(filterBudgetUsed({
      filters: [eq('a')], having,
      calculations: [{ name: 'f', filter: { measure: 'm', where: [eq('b'), eq('c')] } }, { name: 'r', rank: { measure: 'm' } }, null],
    })).toBe(4);
  });
});
