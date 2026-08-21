import { describe, expect, it } from 'vitest';
import { compareCase } from './compare.js';
import type { EnumeratedCase, FixtureRole, HandlerResult } from './types.js';

function makeCase(role: FixtureRole, family: string, caseFields: Record<string, unknown>): EnumeratedCase {
  return { family, role, id: 'case', case: caseFields };
}

describe('compareCase', () => {
  it('passes an accepted success case', () => {
    const ec = makeCase('success', 'query-schemas-v1', {});
    expect(compareCase(ec, { ok: true }).status).toBe('pass');
  });

  it('checks canonical bytes and hash for tagged-value success', () => {
    const ec = makeCase('success', 'tagged-values-v1', { canonicalHex: 'ab', sha256: 'ff' });
    expect(compareCase(ec, { ok: true, output: { canonicalHex: 'ab', sha256: 'ff' } }).status).toBe('pass');
    expect(compareCase(ec, { ok: true, output: { canonicalHex: 'cd', sha256: 'ff' } }).status).toBe('fail');
  });

  it('checks segments for identifier success', () => {
    const ec = makeCase('success', 'identifiers-v1', { segments: ['a', 'b'] });
    expect(compareCase(ec, { ok: true, output: { segments: ['a', 'b'] } }).status).toBe('pass');
    expect(compareCase(ec, { ok: true, output: { segments: ['a'] } }).status).toBe('fail');
  });

  it('checks the derived key and namespace token for cache-key success', () => {
    const ec = makeCase('success', 'cache-keys-v1', { key: 'hq1.1.ns.mac', namespaceToken: 'ns' });
    expect(compareCase(ec, { ok: true, output: { key: 'hq1.1.ns.mac', namespaceToken: 'ns' } }).status)
      .toBe('pass');
    // A family whose output is not compared would pass all three of these.
    expect(compareCase(ec, { ok: true, output: { key: 'hq1.1.ns.other', namespaceToken: 'ns' } }).status)
      .toBe('fail');
    expect(compareCase(ec, { ok: true, output: { key: 'hq1.1.ns.mac', namespaceToken: 'other' } }).status)
      .toBe('fail');
    expect(compareCase(ec, { ok: true, output: {} }).status).toBe('fail');
  });

  it('requires the exact rejection code', () => {
    const ec = makeCase('rejection', 'tagged-values-v1', { error: 'HQ_VALUE_TOO_LARGE' });
    expect(compareCase(ec, { ok: false, code: 'HQ_VALUE_TOO_LARGE' }).status).toBe('pass');
    expect(compareCase(ec, { ok: false, code: 'HQ_VALUE_TOO_DEEP' }).status).toBe('fail');
    expect(compareCase(ec, { ok: true }).status).toBe('fail');
  });

  it('checks code and start for non-portable', () => {
    const ec = makeCase('non-portable', 'sql-portability-v1', { code: 'HQ_SQL_PORT_SYNTAX', start: 3 });
    expect(compareCase(ec, { ok: false, code: 'HQ_SQL_PORT_SYNTAX', output: { start: 3 } }).status).toBe('pass');
    expect(compareCase(ec, { ok: false, code: 'HQ_SQL_PORT_SYNTAX', output: { start: 4 } }).status).toBe('fail');
  });

  it('deep-compares expression and dependencies for portable', () => {
    const expression = { kind: 'reference', name: 'x' };
    const ec = makeCase('portable', 'sql-portability-v1', { expression, dependencies: ['x'] });
    expect(compareCase(ec, { ok: true, output: { expression, dependencies: ['x'] } }).status).toBe('pass');
    expect(compareCase(ec, { ok: true, output: { expression, dependencies: ['y'] } }).status).toBe('fail');
  });

  it('checks canonical and hash for identity', () => {
    const ec = makeCase('identity', 'deployments-v1', { canonical: '{}', sha256: 'aa' });
    expect(compareCase(ec, { ok: true, output: { canonical: '{}', sha256: 'aa' } }).status).toBe('pass');
    expect(compareCase(ec, { ok: true, output: { canonical: '{}', sha256: 'bb' } }).status).toBe('fail');
  });

  it('accepts any stable outcome for a fuzz case', () => {
    const ec = makeCase('fuzz', 'tagged-values-v1', { id: 'seed' });
    expect(compareCase(ec, { ok: true }).status).toBe('pass');
    expect(compareCase(ec, { ok: false, code: 'HQ_VALUE_INVALID_JSON' }).status).toBe('pass');
    expect(compareCase(ec, { ok: false, code: 'not-a-code' }).status).toBe('fail');
  });

  it('allows a skip only for the unsafe-accessor rejection case', () => {
    const accessor = makeCase('rejection', 'query-events-v1', {
      generator: { type: 'unsafe-accessor' },
      error: 'HQ_EVENT_UNSAFE_OBJECT',
    });
    const skip: HandlerResult = { skipped: true, reason: 'no computed accessors' };
    expect(compareCase(accessor, skip).status).toBe('skip');

    const ordinary = makeCase('rejection', 'query-events-v1', {
      generator: { type: 'wrong-root-type' },
      error: 'HQ_EVENT_TYPE',
    });
    expect(compareCase(ordinary, skip).status).toBe('fail');
  });
});
