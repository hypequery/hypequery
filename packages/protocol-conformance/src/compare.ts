// Pure comparison of an adapter result against the expectation encoded by a
// case's role. Returns the case outcome the runner records.
import type { CaseOutcome, EnumeratedCase, HandlerResult } from './types.js';

const STABLE_CODE = /^HQ_[A-Z0-9_]+$/;

/** Order-insensitive structural equality via canonical JSON. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
    .join(',')}}`;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

function outcome(
  ec: EnumeratedCase,
  status: CaseOutcome['status'],
  extra: Partial<CaseOutcome> = {},
): CaseOutcome {
  return { family: ec.family, role: ec.role, id: ec.id, status, ...extra };
}

function isUnsafeAccessorCase(ec: EnumeratedCase): boolean {
  const generator = ec.case.generator as { type?: string } | undefined;
  return generator?.type === 'unsafe-accessor';
}

function output(result: HandlerResult): Record<string, unknown> {
  return ('output' in result && result.output ? result.output : {}) as Record<string, unknown>;
}

export function compareCase(ec: EnumeratedCase, result: HandlerResult): CaseOutcome {
  if ('skipped' in result) {
    // A skip is only legitimate for the host-model-conditional accessor case.
    if (ec.role === 'rejection' && isUnsafeAccessorCase(ec)) {
      return outcome(ec, 'skip', { message: result.reason });
    }
    return outcome(ec, 'fail', {
      expected: 'a result',
      actual: 'skipped',
      message: result.reason ?? 'case may not be skipped',
    });
  }

  const ok = result.ok === true;
  const code = result.ok === false ? result.code : undefined;

  switch (ec.role) {
    case 'success': {
      if (!ok) return outcome(ec, 'fail', { expected: 'accepted', actual: code });
      return compareSuccessOutput(ec, output(result));
    }
    case 'identity': {
      if (!ok) return outcome(ec, 'fail', { expected: 'accepted', actual: code });
      const o = output(result);
      if (o.canonical !== ec.case.canonical) {
        return outcome(ec, 'fail', { expected: 'canonical bytes', actual: 'mismatch' });
      }
      if (o.sha256 !== ec.case.sha256) {
        return outcome(ec, 'fail', { expected: String(ec.case.sha256), actual: String(o.sha256) });
      }
      return outcome(ec, 'pass');
    }
    case 'portable': {
      if (!ok) return outcome(ec, 'fail', { expected: 'portable', actual: code });
      const o = output(result);
      if (!deepEqual(o.expression, ec.case.expression)) {
        return outcome(ec, 'fail', { expected: 'expression AST', actual: 'mismatch' });
      }
      if (!deepEqual(o.dependencies, ec.case.dependencies)) {
        return outcome(ec, 'fail', { expected: 'dependencies', actual: 'mismatch' });
      }
      return outcome(ec, 'pass');
    }
    case 'rejection': {
      if (ok) return outcome(ec, 'fail', { expected: String(ec.case.error), actual: 'accepted' });
      if (code !== ec.case.error) {
        return outcome(ec, 'fail', { expected: String(ec.case.error), actual: String(code) });
      }
      return outcome(ec, 'pass');
    }
    case 'non-portable': {
      if (ok) return outcome(ec, 'fail', { expected: String(ec.case.code), actual: 'accepted' });
      if (code !== ec.case.code) {
        return outcome(ec, 'fail', { expected: String(ec.case.code), actual: String(code) });
      }
      const o = output(result);
      if (o.start !== ec.case.start) {
        return outcome(ec, 'fail', {
          expected: `start ${String(ec.case.start)}`,
          actual: `start ${String(o.start)}`,
        });
      }
      return outcome(ec, 'pass');
    }
    case 'fuzz': {
      if (ok) return outcome(ec, 'pass');
      if (code !== undefined && STABLE_CODE.test(code)) return outcome(ec, 'pass');
      return outcome(ec, 'fail', {
        expected: 'accept or HQ_ code',
        actual: code ?? 'malformed result',
      });
    }
    default:
      return outcome(ec, 'fail', { message: `unknown role ${ec.role}` });
  }
}

function compareSuccessOutput(ec: EnumeratedCase, o: Record<string, unknown>): CaseOutcome {
  if (ec.family === 'tagged-values-v1') {
    if (o.canonicalHex !== ec.case.canonicalHex) {
      return outcome(ec, 'fail', { expected: 'canonicalHex', actual: 'mismatch' });
    }
    if (o.sha256 !== ec.case.sha256) {
      return outcome(ec, 'fail', { expected: String(ec.case.sha256), actual: String(o.sha256) });
    }
  }
  if (ec.family === 'identifiers-v1') {
    if (!deepEqual(o.segments, ec.case.segments)) {
      return outcome(ec, 'fail', { expected: 'segments', actual: 'mismatch' });
    }
  }
  if (ec.family === 'cache-keys-v1') {
    // Reported as 'mismatch' rather than by value: a run against non-fixture
    // inputs would otherwise print keys derived from a real secret.
    if (o.key !== ec.case.key) {
      return outcome(ec, 'fail', { expected: 'key', actual: 'mismatch' });
    }
    if (o.namespaceToken !== ec.case.namespaceToken) {
      return outcome(ec, 'fail', { expected: 'namespaceToken', actual: 'mismatch' });
    }
  }
  return outcome(ec, 'pass');
}
