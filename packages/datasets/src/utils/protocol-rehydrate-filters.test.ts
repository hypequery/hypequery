import { describe, expect, it } from 'vitest';
import type { ProtocolExpression } from '@hypequery/protocol';
import { rehydrateMeasureFilter } from './protocol-rehydrate-filters.js';

const unsupported = () => new Error('Unsupported filter contract');

describe('measure filter contract rehydration', () => {
  it.each([
    ['eq', null, null], ['eq', 'US', 'US'],
    ['in', { $hypequery: { type: 'array', version: 1, values: [1, 2] } }, [1, 2]],
    ['eq', { $hypequery: { type: 'timestamp', version: 1, value: '2026-01-01T00:00:00Z' } }, '2026-01-01T00:00:00Z'],
  ])('restores %s authored values', (operator, value, expected) => {
    const expression = { kind: 'comparison', operator, left: { kind: 'reference', name: 'amount' }, right: { kind: 'literal', value } } as ProtocolExpression;
    expect(rehydrateMeasureFilter(expression, unsupported)).toEqual({ field: 'amount', operator, value: expected });
  });

  it.each([
    { kind: 'literal', value: 1 },
    { kind: 'comparison', operator: 'eq', left: { kind: 'literal', value: 1 }, right: { kind: 'reference', name: 'amount' } },
    { kind: 'comparison', operator: 'eq', left: { kind: 'reference', name: 'amount' }, right: { kind: 'literal', value: {} } },
    { kind: 'comparison', operator: 'eq', left: { kind: 'reference', name: 'amount' }, right: { kind: 'literal', value: { $hypequery: { type: 'timestamp' } } } },
  ])('refuses unsupported or malformed contract expressions', expression => {
    expect(() => rehydrateMeasureFilter(expression as ProtocolExpression, unsupported)).toThrow('Unsupported filter contract');
  });
});
