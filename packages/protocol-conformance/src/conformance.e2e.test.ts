import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runConformance } from './runner.js';

// The literal RFC 0012 acceptance criterion: the TypeScript reference
// implementation passes the whole suite. Runs the built reference adapter
// (produced by the package build that `test` depends on) over the in-repo
// fixtures. The datasets sql-portability adapter is covered separately by the
// root `pnpm conformance` script, which runs after a full workspace build.
const fixturesDir = fileURLToPath(
  new URL('../../../specs/security-protocol/fixtures/', import.meta.url),
);
const referenceAdapter = fileURLToPath(
  new URL('../dist/bin/reference-adapter.js', import.meta.url),
);

describe('reference adapter conformance', () => {
  it('passes every reference-family case with no failures or skips', async () => {
    const summary = await runConformance({
      fixturesDir,
      adapterCommand: ['node', referenceAdapter],
      timeoutMs: 10_000,
    });

    if (summary.failed > 0) {
      const failures = summary.outcomes
        .filter((o) => o.status === 'fail')
        .map((o) => `${o.family}/${o.role}/${o.id}: expected ${o.expected}, got ${o.actual}`)
        .join('\n');
      throw new Error(`conformance failures:\n${failures}`);
    }

    expect(summary.failed).toBe(0);
    expect(summary.skipped).toBe(0);
    expect(summary.passed).toBeGreaterThan(300);
  }, 60_000);
});
