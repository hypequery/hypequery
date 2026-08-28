import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runConformance } from './runner.js';

const miniFixtures = fileURLToPath(new URL('./testdata/mini-fixtures/', import.meta.url));
const hostFixtures = fileURLToPath(new URL('./testdata/host-fixtures/', import.meta.url));
const adapter = (name: string): string[] => [
  'node',
  fileURLToPath(new URL(`./testdata/${name}`, import.meta.url)),
];

describe('runConformance', () => {
  it('passes every case against a well-behaved adapter', async () => {
    const summary = await runConformance({
      fixturesDir: miniFixtures,
      adapterCommand: adapter('good-adapter.mjs'),
    });
    expect(summary.failed).toBe(0);
    expect(summary.passed).toBe(4);
    expect(summary.notRun).toBe(0);
    // The RFC 0012 hostile-object suite declaration rides the hello message
    // into the published summary.
    expect(summary.adapter?.hostileObjectSuite)
      .toEqual({ count: 2, mechanisms: ['getter', 'toJSON'] });
  });

  it('rejects malformed hostile-object metadata from an adapter', async () => {
    await expect(runConformance({
      fixturesDir: miniFixtures,
      adapterCommand: adapter('malformed-suite-adapter.mjs'),
    })).rejects.toThrow('mechanisms must be unique non-empty strings');
  });

  it('reports cases whose family the adapter does not announce', async () => {
    const summary = await runConformance({
      fixturesDir: miniFixtures,
      adapterCommand: [...adapter('good-adapter.mjs'), 'fam-a'],
    });
    // fam-b/success/b1 is not announced.
    expect(summary.notRun).toBe(1);
    expect(summary.passed).toBe(3);
  });

  it('rejects a missing hostile-object suite for a host-model family', async () => {
    await expect(runConformance({
      fixturesDir: hostFixtures,
      adapterCommand: [...adapter('suite-adapter.mjs'), 'missing'],
    })).rejects.toThrow('must declare hostileObjectSuite');
  });

  it('rejects a malformed hostile-object suite during the handshake', async () => {
    await expect(runConformance({
      fixturesDir: hostFixtures,
      adapterCommand: [...adapter('suite-adapter.mjs'), 'malformed'],
    })).rejects.toThrow('mechanisms must be unique non-empty strings');
  });

  it('restricts to requested families', async () => {
    const summary = await runConformance({
      fixturesDir: miniFixtures,
      families: ['fam-a'],
      adapterCommand: adapter('good-adapter.mjs'),
    });
    expect(summary.total).toBe(3);
    expect(summary.passed).toBe(3);
  });

  it('asserts the exact adapter family set without depending on order', async () => {
    const summary = await runConformance({
      fixturesDir: miniFixtures,
      expectedFamilies: ['fam-b', 'fam-a'],
      adapterCommand: adapter('good-adapter.mjs'),
    });
    expect(summary.failed).toBe(0);
    expect(summary.notRun).toBe(0);
  });

  it('rejects silently dropped or unexpectedly added adapter families', async () => {
    await expect(runConformance({
      fixturesDir: miniFixtures,
      expectedFamilies: ['fam-a', 'fam-b'],
      adapterCommand: [...adapter('good-adapter.mjs'), 'fam-a'],
    })).rejects.toThrow('announced fam-a');

    await expect(runConformance({
      fixturesDir: miniFixtures,
      expectedFamilies: ['fam-a'],
      adapterCommand: adapter('good-adapter.mjs'),
    })).rejects.toThrow('announced fam-a, fam-b');
  });

  it('rejects expected families that are duplicated or absent from the manifest', async () => {
    await expect(runConformance({
      fixturesDir: miniFixtures,
      expectedFamilies: ['fam-a', 'fam-a'],
      adapterCommand: adapter('good-adapter.mjs'),
    })).rejects.toThrow('unique non-empty strings');

    await expect(runConformance({
      fixturesDir: miniFixtures,
      expectedFamilies: ['fam-c'],
      adapterCommand: adapter('good-adapter.mjs'),
    })).rejects.toThrow('absent from the manifest: fam-c');
  });

  it('rejects a release gate that filters out an expected adapter family', async () => {
    await expect(runConformance({
      fixturesDir: miniFixtures,
      families: ['fam-a'],
      expectedFamilies: ['fam-a', 'fam-b'],
      adapterCommand: adapter('good-adapter.mjs'),
    })).rejects.toThrow('selected fam-a');
  });

  it('rejects an expected family with no cases after role filters', async () => {
    await expect(runConformance({
      fixturesDir: miniFixtures,
      expectedFamilies: ['fam-a', 'fam-b'],
      onlyFuzz: true,
      adapterCommand: adapter('good-adapter.mjs'),
    })).rejects.toThrow('expected families have no selected cases: fam-a, fam-b');
  });

  it('fails cases when the adapter never answers', async () => {
    const summary = await runConformance({
      fixturesDir: miniFixtures,
      adapterCommand: adapter('timeout-adapter.mjs'),
      timeoutMs: 200,
    });
    expect(summary.failed).toBeGreaterThan(0);
    expect(summary.outcomes.some((o) => o.actual === 'timeout')).toBe(true);
  });

  it('recovers from a timed-out case without desynchronizing later cases', async () => {
    const summary = await runConformance({
      fixturesDir: miniFixtures,
      adapterCommand: adapter('slow-first-adapter.mjs'),
      timeoutMs: 300,
    });
    // s1 times out; the stale connection and its late reply are discarded, so
    // the remaining three cases are answered correctly rather than shifted by
    // one and failing the sequence check.
    expect(summary.passed).toBe(3);
    expect(summary.outcomes.filter((o) => o.status === 'fail')).toHaveLength(1);
    expect(summary.outcomes.some((o) => o.actual === 'out-of-order result')).toBe(false);
  });

  it('respawns once after a mid-stream exit and keeps going', async () => {
    const summary = await runConformance({
      fixturesDir: miniFixtures,
      adapterCommand: adapter('crash-adapter.mjs'),
      timeoutMs: 500,
    });
    // First case passes; the crash fails the in-flight case; the run still ends.
    expect(summary.passed).toBeGreaterThanOrEqual(1);
    expect(summary.failed).toBeGreaterThanOrEqual(1);
  });

  it('flags out-of-order results as protocol errors', async () => {
    const summary = await runConformance({
      fixturesDir: miniFixtures,
      adapterCommand: adapter('wrong-seq-adapter.mjs'),
      timeoutMs: 500,
    });
    expect(summary.passed).toBe(0);
    expect(summary.outcomes.every((o) => o.status === 'fail')).toBe(true);
  });
});
