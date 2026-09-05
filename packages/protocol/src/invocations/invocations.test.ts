import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROTOCOL_SEMANTIC_INVOCATION_LIMITS,
  ProtocolSemanticInvocationError,
  validateProtocolSemanticInvocation,
  validateProtocolSemanticInvocationFailure,
  validateProtocolSemanticInvocationResult,
} from './index.js';

type Record = 'invocation' | 'result' | 'failure';
interface SuccessFixture { id: string; record: Record; value: unknown }
interface RejectionFixture {
  id: string;
  record: Record;
  generator: { type: string };
  error: string;
}

const FAILURE_CODES = [
  'HQ_INVOCATION_TYPE',
  'HQ_INVOCATION_UNKNOWN_FIELD',
  'HQ_INVOCATION_INVALID_VERSION',
  'HQ_INVOCATION_INVALID_VALUE',
  'HQ_INVOCATION_TOO_MANY_ITEMS',
  'HQ_INVOCATION_TOO_LARGE',
  'HQ_INVOCATION_UNSAFE_OBJECT',
] as const;

const REVISION = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function readFixture<T>(name: string): T {
  const path = fileURLToPath(new URL(
    `../../../../specs/security-protocol/fixtures/semantic-invocations-v1/${name}`,
    import.meta.url,
  ));
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

const VALIDATORS = {
  invocation: validateProtocolSemanticInvocation,
  result: validateProtocolSemanticInvocationResult,
  failure: validateProtocolSemanticInvocationFailure,
} as const;

function baseInvocation() {
  return {
    kind: 'hypequery-semantic-invocation',
    version: 1,
    target: { project: 'acme', environment: 'production' },
    operation: { kind: 'dataset', dataset: 'orders', measures: ['revenue'] },
  };
}

function baseResult() {
  return {
    kind: 'hypequery-semantic-invocation-result',
    version: 1,
    activationRevision: REVISION,
    data: [{ status: 'paid' }],
    meta: { rowCount: 1 },
  };
}

function baseFailure() {
  return {
    kind: 'hypequery-semantic-invocation-failure',
    version: 1,
    category: 'input-invalid',
    code: 'HQ_SEMANTIC_UNKNOWN_DIMENSION',
    message: 'Unknown dimension.',
    retryable: false,
    relist: false,
  };
}

function materialize(type: string): unknown {
  switch (type) {
    case 'wrong-root-type':
      return [];
    case 'unknown-root-field':
      return { ...baseInvocation(), extra: true };
    case 'unsupported-version':
      return { ...baseInvocation(), version: 2 };
    case 'caller-supplied-tenant':
      // The central guarantee of decision 0002: a caller cannot name a tenant.
      return { ...baseInvocation(), tenant: 'acme' };
    case 'redundant-operation-dataset':
      // Identifiers are normalized into `operation`; a second copy beside it
      // could disagree, so the field is simply not part of the record.
      return { ...baseInvocation(), dataset: 'orders' };
    case 'malformed-activation-revision':
      return { ...baseInvocation(), activationRevision: 'not-a-digest' };
    case 'empty-budget':
      return { ...baseInvocation(), budget: {} };
    case 'zero-deadline':
      return { ...baseInvocation(), budget: { deadlineMs: 0 } };
    case 'deadline-too-large':
      return {
        ...baseInvocation(),
        budget: { deadlineMs: DEFAULT_PROTOCOL_SEMANTIC_INVOCATION_LIMITS.maxDeadlineMs + 1 },
      };
    case 'correlation-id-control-character':
      // Escaped rather than a literal byte: a formatter that stripped an
      // invisible control character would silently disarm this case.
      return { ...baseInvocation(), correlationId: 'req\u0007id' };
    case 'unsafe-accessor': {
      const unsafe = baseInvocation() as globalThis.Record<string, unknown>;
      Object.defineProperty(unsafe, 'kind', {
        enumerable: true,
        get: () => 'hypequery-semantic-invocation',
      });
      return unsafe;
    }
    case 'too-many-rows': {
      const rows = DEFAULT_PROTOCOL_SEMANTIC_INVOCATION_LIMITS.maxRows + 1;
      return {
        ...baseResult(),
        data: Array.from({ length: rows }, () => ({ status: 'paid' })),
        meta: { rowCount: rows },
      };
    }
    case 'too-many-columns': {
      const columns = DEFAULT_PROTOCOL_SEMANTIC_INVOCATION_LIMITS.maxColumnsPerRow + 1;
      return {
        ...baseResult(),
        data: [Object.fromEntries(
          Array.from({ length: columns }, (_, index) => [`c${index}`, index]),
        )],
      };
    }
    case 'non-finite-cell':
      return { ...baseResult(), data: [{ revenue: Number.POSITIVE_INFINITY }] };
    case 'nested-cell':
      return { ...baseResult(), data: [{ breakdown: { paid: 1 } }] };
    case 'cell-too-large':
      return {
        ...baseResult(),
        data: [{
          note: 'a'.repeat(DEFAULT_PROTOCOL_SEMANTIC_INVOCATION_LIMITS.maxValueBytes + 1),
        }],
      };
    case 'row-count-mismatch':
      return { ...baseResult(), meta: { rowCount: 9 } };
    case 'sparse-data-array': {
      const data = [{ status: 'paid' }];
      // eslint-disable-next-line no-sparse-arrays
      (data as unknown[]).length = 3;
      return { ...baseResult(), data, meta: { rowCount: 3 } };
    }
    case 'unknown-failure-category':
      return { ...baseFailure(), category: 'exploded' };
    case 'provider-shaped-failure-code':
      return { ...baseFailure(), code: 'ClickHouseException: DB::Exception' };
    case 'failure-message-too-large':
      return {
        ...baseFailure(),
        message: 'a'.repeat(DEFAULT_PROTOCOL_SEMANTIC_INVOCATION_LIMITS.maxMessageBytes + 1),
      };
    default:
      throw new Error(`Unknown fixture generator: ${type}`);
  }
}

describe('semantic invocation v1', () => {
  const success = readFixture<SuccessFixture[]>('success.json');
  const rejections = readFixture<RejectionFixture[]>('rejections.json');

  it('has unique fixtures and covers every stable error code', () => {
    const fixtures = [...success, ...rejections];
    expect(new Set(fixtures.map(fixture => fixture.id)).size).toBe(fixtures.length);
    expect([...new Set(rejections.map(fixture => fixture.error))].sort())
      .toEqual([...FAILURE_CODES].sort());
  });

  it.each(success)('accepts $id as an immutable snapshot', ({ record, value }) => {
    const validated = VALIDATORS[record](value);
    expect(validated).toEqual(value);
    expect(Object.isFrozen(validated)).toBe(true);
  });

  it.each(rejections)('rejects $id with its stable code', ({ record, generator, error }) => {
    try {
      VALIDATORS[record](materialize(generator.type));
      throw new Error('Expected semantic invocation validation to fail');
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(ProtocolSemanticInvocationError);
      expect((thrown as ProtocolSemanticInvocationError).code).toBe(error);
    }
  });

  it('covers every fixture generator', () => {
    for (const fixture of rejections) {
      expect(() => materialize(fixture.generator.type)).not.toThrow(/Unknown fixture generator/);
    }
  });

  it('detaches the snapshot from a later mutation of the input', () => {
    const input = {
      ...baseResult(),
      data: [{ status: 'paid' }],
      meta: { rowCount: 1 },
    };
    const validated = validateProtocolSemanticInvocationResult(input);

    input.data[0].status = 'refunded';
    (input.meta as { rowCount: number }).rowCount = 99;

    expect(validated.data[0].status).toBe('paid');
    expect(validated.meta.rowCount).toBe(1);
    expect(Object.isFrozen(validated.data)).toBe(true);
    expect(Object.isFrozen(validated.data[0])).toBe(true);
  });

  it('rejects a budget above a tightened limit but accepts it by default', () => {
    const invocation = { ...baseInvocation(), budget: { maxRows: 5_000 } };

    expect(validateProtocolSemanticInvocation(invocation).budget?.maxRows).toBe(5_000);
    expect(() => validateProtocolSemanticInvocation(invocation, { limits: { maxRows: 100 } }))
      .toThrow(ProtocolSemanticInvocationError);
  });

  it('refuses to raise a limit above the v1 conformance maximum', () => {
    expect(() => validateProtocolSemanticInvocation(baseInvocation(), {
      limits: { maxRows: DEFAULT_PROTOCOL_SEMANTIC_INVOCATION_LIMITS.maxRows + 1 },
    })).toThrow(RangeError);
  });

  it('accepts both operation kinds and keeps their identifiers in one place', () => {
    const dataset = validateProtocolSemanticInvocation(baseInvocation());
    expect(dataset.operation).toMatchObject({ kind: 'dataset', dataset: 'orders' });
    expect('dataset' in dataset).toBe(false);

    const metric = validateProtocolSemanticInvocation({
      ...baseInvocation(),
      operation: { kind: 'metric', dataset: 'orders', metric: 'total_revenue' },
    });
    expect(metric.operation).toMatchObject({ kind: 'metric', metric: 'total_revenue' });
    expect('metric' in metric).toBe(false);
  });
});
