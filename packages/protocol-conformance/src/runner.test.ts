import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runConformance } from './runner.js';

const miniFixtures = fileURLToPath(new URL('./testdata/mini-fixtures/', import.meta.url));
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

  it('restricts to requested families', async () => {
    const summary = await runConformance({
      fixturesDir: miniFixtures,
      families: ['fam-a'],
      adapterCommand: adapter('good-adapter.mjs'),
    });
    expect(summary.total).toBe(3);
    expect(summary.passed).toBe(3);
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
