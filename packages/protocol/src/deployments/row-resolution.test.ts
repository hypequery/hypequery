import { describe, expect, it } from 'vitest';
import { validateProtocolRowResolution } from './row-resolution.js';
import { validateProtocolDeploymentContract } from './validate.js';

const base = { kind: 'hypequery-deployment', version: 2, datasets: [{
  name: 'users', source: 'users', tenant: { kind: 'not-required' }, dimensions: [],
  measures: [], filters: [], relationships: [],
}] };

describe('resolved row policy', () => {
  it('validates and freezes replacing and collapsing policies', () => {
    expect(validateProtocolRowResolution({ kind: 'final', engine: 'replacing', deletedColumn: 'is_deleted' })).toEqual({ kind: 'final', engine: 'replacing', deletedColumn: 'is_deleted' });
    expect(Object.isFrozen(validateProtocolRowResolution({ kind: 'final', engine: 'collapsing', signColumn: 'sign' }))).toBe(true);
  });
  it.each([
    { kind: 'final', engine: 'aggregating' },
    { kind: 'final', engine: 'summing' },
    { kind: 'final', engine: 'collapsing' },
    { kind: 'argmax', engine: 'replacing' },
    { kind: 'final', engine: 'replacing', deletedColumn: 'deleted) OR 1' },
    { kind: 'final', engine: 'replacing', signColumn: 'sign' },
    { kind: 'final', engine: 'collapsing', signColumn: 'sign', deletedColumn: 'deleted' },
  ])('rejects unsupported or unsafe policies: %j', input => {
    expect(() => validateProtocolRowResolution(input)).toThrow();
  });
  it('rejects accessors without calling them and hidden unknown fields', () => {
    let calls = 0;
    const accessor = { kind: 'final', get engine() { calls++; return 'replacing'; } };
    expect(() => validateProtocolRowResolution(accessor)).toThrow();
    expect(calls).toBe(0);
    const hidden = Object.defineProperty({ kind: 'final', engine: 'replacing' }, 'sql', { value: 'raw' });
    expect(() => validateProtocolRowResolution(hidden)).toThrow();
    expect(() => validateProtocolRowResolution({ engine: 'replacing' })).toThrow();
  });
  it('preserves the policy in deployment validation', () => {
    const rowResolution = { kind: 'final', engine: 'replacing', deletedColumn: 'deleted' };
    const input = { ...base, datasets: [{ ...base.datasets[0], rowResolution }] };
    expect(validateProtocolDeploymentContract(input).datasets[0].rowResolution).toEqual(rowResolution);
  });
});
