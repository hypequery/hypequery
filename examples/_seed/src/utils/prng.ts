/**
 * Small, fast, seedable PRNG (mulberry32). Same seed, same sequence, on every
 * platform: the whole seed dataset depends on that.
 */
export class Prng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Pick one element uniformly. */
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  /** Pick one element by relative weight. */
  weighted<T>(items: ReadonlyArray<readonly [T, number]>): T {
    let total = 0;
    for (const [, weight] of items) total += weight;
    let roll = this.next() * total;
    for (const [item, weight] of items) {
      roll -= weight;
      if (roll < 0) return item;
    }
    return items[items.length - 1][0];
  }

  /** Approximately normal via the sum of 6 uniforms (cheap, deterministic). */
  gaussian(mean: number, stddev: number): number {
    let sum = 0;
    for (let k = 0; k < 6; k += 1) sum += this.next();
    return mean + (sum - 3) * stddev;
  }

  /** Exponential with the given mean. */
  exponential(mean: number): number {
    return -Math.log(1 - this.next()) * mean;
  }
}
