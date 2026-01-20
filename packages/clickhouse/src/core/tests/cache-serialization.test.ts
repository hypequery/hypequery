import { describe, it, expect } from 'vitest';
import {
  stableStringify,
  defaultSerialize,
  defaultDeserialize,
  estimateByteSize
} from '../cache/serialization.js';

describe('cache serialization helpers', () => {
  it('normalizes complex structures for stable stringify', () => {
    const input = {
      b: 1,
      a: 2,
      nested: {
        set: new Set(['beta', 'alpha']),
        map: new Map([
          ['zeta', 2],
          ['alpha', 1]
        ])
      },
      timestamp: new Date('2024-06-01T12:00:00.000Z'),
      size: 123n,
      flag: Number.NaN
    };

    const normalized = JSON.parse(stableStringify(input));

    expect(normalized).toEqual({
      a: 2,
      b: 1,
      flag: { __hq_type: 'nan', value: 'NaN' },
      nested: {
        map: {
          alpha: 1,
          zeta: 2
        },
        set: ['alpha', 'beta']
      },
      size: { __hq_type: 'bigint', value: '123' },
      timestamp: { __hq_type: 'date', value: '2024-06-01T12:00:00.000Z' }
    });
  });

  it('round-trips supported special values through defaultSerialize/defaultDeserialize', () => {
    const payload = {
      bytes: new Uint8Array([1, 2, 3]),
      id: 999n,
      name: 'widget',
      missing: undefined
    };

    const serialized = defaultSerialize(payload);
    expect(serialized.byteSize).toBeGreaterThan(0);

    const restored = defaultDeserialize<typeof payload>(serialized.payload);
    expect(restored.name).toBe('widget');
    expect(restored.id).toBe(999n);
    expect(restored.missing).toBeUndefined();
    expect(restored.bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(restored.bytes as Uint8Array)).toEqual([1, 2, 3]);
  });

  it('estimates byte size consistently with UTF-8 encoding', () => {
    const value = { greeting: 'hello', emoji: '🚀' };
    const estimated = estimateByteSize(value);
    const actual = Buffer.from(JSON.stringify(value), 'utf8').byteLength;
    expect(estimated).toBe(actual);
  });
});
