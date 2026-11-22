import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ProtocolExpressionError } from '../expressions/index.js';
import {
  ProtocolSemanticInvocationError,
  validateProtocolSemanticInvocation,
  validateProtocolSemanticInvocationV2,
} from '../invocations/index.js';
import {
  isProtocolEventOperationKind,
  parseProtocolEventWindow,
  validateProtocolEventOperation,
} from './index.js';

interface SuccessFixture { id: string; value: unknown }
interface RejectionFixture { id: string; value: unknown; error: string }

function readFixture<T>(name: string): T {
  const path = fileURLToPath(new URL(
    `../../../../specs/security-protocol/fixtures/event-operations-v1/${name}`,
    import.meta.url,
  ));
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function rejection(input: unknown): ProtocolExpressionError {
  try {
    validateProtocolEventOperation(input);
  } catch (error) {
    if (error instanceof ProtocolExpressionError) return error;
    throw error;
  }
  throw new Error('Expected the operation to be rejected');
}

const equals = (field: string, value: string) => ({
  kind: 'comparison', operator: 'eq',
  left: { kind: 'reference', name: field },
  right: { kind: 'literal', value },
});

const RANGE = {
  kind: 'comparison', operator: 'between',
  left: { kind: 'reference', name: 'occurredAt' },
  right: { kind: 'literal', value: { $hypequery: { type: 'tuple', version: 1, values: ['2026-10-01', '2026-11-01'] } } },
};

function funnel(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'funnel',
    dataset: 'activity',
    steps: [
      { name: 'signed_up', where: [equals('eventName', 'signup')] },
      { name: 'first_query', where: [equals('eventName', 'query_run')] },
    ],
    window: '7 day',
    filters: [RANGE],
    ...overrides,
  };
}

describe('event operations (RFC 0027)', () => {
  const success = readFixture<SuccessFixture[]>('success.json');
  const rejections = readFixture<RejectionFixture[]>('rejections.json');

  it('has unique fixture ids', () => {
    const ids = [...success, ...rejections].map(fixture => fixture.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(success)('accepts $id as an immutable snapshot', ({ value }) => {
    const validated = validateProtocolEventOperation(value);
    expect(validated).toEqual(value);
    expect(Object.isFrozen(validated)).toBe(true);
    expect(Object.isFrozen(validated.steps)).toBe(true);
    expect(Object.isFrozen(validated.steps[0])).toBe(true);
  });

  it.each(rejections)('rejects $id with $error', ({ value, error }) => {
    expect(rejection(value).code).toBe(error);
  });

  it('reports a nested predicate failure at its place in the operation', () => {
    const steps = funnel().steps.map(step => ({ ...step }));
    steps[1] = {
      name: 'first_query',
      where: [{ ...equals('eventName', 'x'), operator: 'contains' }] as never,
    };
    expect(rejection(funnel({ steps })).path).toBe('$.steps[1].where[0].operator');
  });

  it('reports field paths for operation-level failures', () => {
    expect(rejection(funnel({ window: '7 days' })).path).toBe('$.window');
    expect(rejection(funnel({ breakdown: ['plan', 'step'] })).path).toBe('$.breakdown[1]');
    expect(rejection(funnel({ breakdownLimit: 5 })).path).toBe('$.breakdownLimit');
  });

  it('keeps document order in the snapshot', () => {
    const validated = validateProtocolEventOperation(funnel({
      timezone: 'UTC', by: 'week', breakdownLimit: 3, breakdown: ['plan'], order: 'any', entity: 'accountId',
    }));
    expect(Object.keys(validated)).toEqual([
      'kind', 'dataset', 'entity', 'steps', 'window', 'order', 'filters',
      'breakdown', 'breakdownLimit', 'by', 'timezone',
    ]);
  });

  it('rejects a mutable or accessor-bearing operation', () => {
    const withGetter = funnel();
    Object.defineProperty(withGetter, 'window', { get: () => '7 day', enumerable: true });
    expect(rejection(withGetter).code).toBe('HQ_EXPRESSION_UNSAFE_OBJECT');
    expect(rejection(Object.assign(Object.create({ polluted: true }), funnel())).code)
      .toBe('HQ_EXPRESSION_UNSAFE_OBJECT');
  });

  it('parses one encoding per window', () => {
    expect(parseProtocolEventWindow('7 day')).toEqual({ amount: 7, unit: 'day', milliseconds: 604_800_000 });
    expect(parseProtocolEventWindow('90 second')?.milliseconds).toBe(90_000);
    for (const text of ['7 days', '07 day', '0 day', '7 Day', ' 7 day', '7 day ', '1.5 day', '7']) {
      expect(parseProtocolEventWindow(text)).toBeUndefined();
    }
  });

  it('recognizes only event operation kinds', () => {
    expect(isProtocolEventOperationKind('funnel')).toBe(true);
    expect(isProtocolEventOperationKind('dataset')).toBe(false);
    expect(isProtocolEventOperationKind(undefined)).toBe(false);
  });
});

describe('event operations in semantic invocations', () => {
  const invocation = (operation: unknown, version = 1) => ({
    kind: 'hypequery-semantic-invocation',
    version,
    target: { project: 'acme', environment: 'production' },
    operation,
  });

  it('accepts a funnel under invocation 1', () => {
    const validated = validateProtocolSemanticInvocation(invocation(funnel()));
    expect(validated.operation).toEqual(funnel());
  });

  it('wraps an invalid funnel as an invalid operation', () => {
    expect(() => validateProtocolSemanticInvocation(invocation(funnel({ steps: [] }))))
      .toThrowError(expect.objectContaining({ code: 'HQ_INVOCATION_INVALID_VALUE', path: '$.operation' }));
  });

  it('refuses a funnel under invocation 2 by the lowest-version rule', () => {
    try {
      validateProtocolSemanticInvocationV2(invocation(funnel(), 2));
      throw new Error('Expected a version failure');
    } catch (error) {
      expect(error).toBeInstanceOf(ProtocolSemanticInvocationError);
      expect((error as ProtocolSemanticInvocationError).code).toBe('HQ_INVOCATION_INVALID_VERSION');
    }
  });
});

describe('invocation dispatch on operation kind', () => {
  it('never runs a getter on the operation before rejecting it', () => {
    let reads = 0;
    const operation = { ...funnel() } as Record<string, unknown>;
    delete operation.kind;
    Object.defineProperty(operation, 'kind', {
      enumerable: true,
      get: () => {
        reads += 1;
        throw new Error('getter ran');
      },
    });
    let thrown: unknown;
    try {
      validateProtocolSemanticInvocation({
        kind: 'hypequery-semantic-invocation', version: 1,
        target: { project: 'acme', environment: 'production' }, operation,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ProtocolSemanticInvocationError);
    expect((thrown as ProtocolSemanticInvocationError).code).toBe('HQ_INVOCATION_INVALID_VALUE');
    expect(reads).toBe(0);
  });
});
