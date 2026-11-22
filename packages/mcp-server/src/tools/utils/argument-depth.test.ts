import { describe, expect, it } from 'vitest';
import { argumentsTooDeep, MAX_ARGUMENT_DEPTH } from './argument-depth.js';

function nested(levels: number): unknown {
  let value: unknown = { field: 'country', operator: 'eq', value: 'US' };
  for (let level = 1; level < levels; level += 1) value = { not: value };
  return value;
}

describe('argumentsTooDeep', () => {
  it('accepts ordinary and moderately nested arguments', () => {
    expect(argumentsTooDeep({ dataset: 'orders', filters: [{ and: [nested(30)] }] })).toBe(false);
    expect(argumentsTooDeep(undefined)).toBe(false);
    expect(argumentsTooDeep(nested(MAX_ARGUMENT_DEPTH))).toBe(false);
  });

  it('refuses nesting past the limit, a cycle and a graph too large to walk', () => {
    expect(argumentsTooDeep(nested(MAX_ARGUMENT_DEPTH + 1))).toBe(true);
    const cycle: Record<string, unknown> = {};
    cycle.not = cycle;
    expect(argumentsTooDeep(cycle)).toBe(true);
    // Each level holds the next one twice: a small graph that walks as a huge tree.
    let shared: unknown = {};
    for (let level = 0; level < 40; level += 1) shared = { and: [shared, shared] };
    expect(argumentsTooDeep(shared)).toBe(true);
  });
});
