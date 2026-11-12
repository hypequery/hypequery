import { describe, expect, it } from 'vitest';
import { Prng } from './prng.js';

describe('Prng', () => {
  it('is deterministic for a given seed', () => {
    const a = new Prng(42);
    const b = new Prng(42);
    const seqA = Array.from({ length: 1000 }, () => a.next());
    const seqB = Array.from({ length: 1000 }, () => b.next());
    expect(seqA).toEqual(seqB);
    expect(new Prng(43).next()).not.toBe(new Prng(42).next());
  });

  it('pins the first values so an accidental algorithm change is visible', () => {
    const rng = new Prng(20261101);
    expect([rng.next(), rng.next(), rng.next()].map((v) => v.toFixed(12))).toMatchInlineSnapshot(`
      [
        "0.673950420460",
        "0.896212138701",
        "0.752615804086",
      ]
    `);
  });

  it('keeps int() within bounds and weighted() proportional', () => {
    const rng = new Prng(7);
    const counts = new Map<string, number>();
    for (let i = 0; i < 20_000; i += 1) {
      const n = rng.int(3, 5);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(5);
      const w = rng.weighted([['a', 1], ['b', 3]] as const);
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
    const ratio = (counts.get('b') ?? 0) / (counts.get('a') ?? 1);
    expect(ratio).toBeGreaterThan(2.6);
    expect(ratio).toBeLessThan(3.4);
  });
});
