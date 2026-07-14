import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ProtocolExpressionError, validateProtocolExpression, validateProtocolSemanticQuery } from './index.js';

interface FixtureEntry { id: string; value: unknown }
interface SuccessFixtures { expressions: FixtureEntry[]; queries: FixtureEntry[] }
interface RejectionFixture {
  id: string;
  mode: 'expression' | 'query';
  value?: unknown;
  generator?:
    | { type: 'nested-not'; depth: number }
    | { type: 'logical-tree' }
    | { type: 'logical-operands'; count: number }
    | { type: 'unsafe-accessor' };
  error: string;
}

const FAILURE_CODES = [
  'HQ_EXPRESSION_TYPE', 'HQ_EXPRESSION_UNKNOWN_FIELD', 'HQ_EXPRESSION_UNKNOWN_KIND',
  'HQ_EXPRESSION_INVALID_IDENTIFIER', 'HQ_EXPRESSION_INVALID_VALUE',
  'HQ_EXPRESSION_INVALID_OPERATOR', 'HQ_EXPRESSION_INVALID_ARITY',
  'HQ_EXPRESSION_INVALID_AGGREGATION', 'HQ_EXPRESSION_INVALID_QUERY',
  'HQ_EXPRESSION_TOO_DEEP', 'HQ_EXPRESSION_TOO_MANY_NODES',
  'HQ_EXPRESSION_TOO_MANY_ITEMS', 'HQ_EXPRESSION_UNSAFE_OBJECT',
] as const;

function readFixture<T>(name: string): T {
  const path = fileURLToPath(new URL(
    `../../../../specs/security-protocol/fixtures/expressions-v1/${name}`,
    import.meta.url,
  ));
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function literal(): unknown {
  return { kind: 'literal', value: false };
}

function nestedPredicate(wrappers: number): unknown {
  let value: unknown = {
    kind: 'comparison',
    operator: 'eq',
    left: { kind: 'reference', name: 'status' },
    right: { kind: 'literal', value: 'paid' },
  };
  for (let index = 0; index < wrappers; index += 1) {
    value = { kind: 'logical', operator: 'not', operand: value };
  }
  return value;
}

function materialize(fixture: RejectionFixture): unknown {
  if (!fixture.generator) return fixture.value;
  const generator = fixture.generator;
  switch (generator.type) {
    case 'nested-not': {
      let value = literal();
      for (let index = 0; index < generator.depth; index += 1) {
        value = { kind: 'logical', operator: 'not', operand: value };
      }
      return value;
    }
    case 'logical-operands':
      return { kind: 'logical', operator: 'and', operands: Array.from({ length: generator.count }, literal) };
    case 'logical-tree': {
      const groups = Array.from({ length: 10 }, () => ({
        kind: 'logical', operator: 'and', operands: Array.from({ length: 100 }, literal),
      }));
      return { kind: 'logical', operator: 'and', operands: groups };
    }
    case 'unsafe-accessor': {
      const value = { kind: 'reference' } as { kind: string; name?: string };
      Object.defineProperty(value, 'name', { enumerable: true, get: () => 'orders' });
      return value;
    }
  }
}

function expectExpressionError(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error('Expected expression validation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(ProtocolExpressionError);
    expect((error as ProtocolExpressionError).code).toBe(code);
  }
}

describe('portable dataset expressions', () => {
  const success = readFixture<SuccessFixtures>('success.json');
  const rejections = readFixture<RejectionFixture[]>('rejections.json');

  it('has unique fixture IDs and covers every stable failure code', () => {
    const entries = [...success.expressions, ...success.queries, ...rejections];
    expect(new Set(entries.map(fixture => fixture.id)).size).toBe(entries.length);
    expect([...new Set(rejections.map(fixture => fixture.error))].sort())
      .toEqual([...FAILURE_CODES].sort());
  });

  it.each(success.expressions)('accepts $id', ({ value }) => {
    expect(validateProtocolExpression(value)).toEqual(value);
  });

  it.each(success.queries)('accepts $id', ({ value }) => {
    expect(validateProtocolSemanticQuery(value)).toEqual(value);
  });

  it.each(rejections)('rejects $id with its stable code', fixture => {
    const input = materialize(fixture);
    const action = fixture.mode === 'expression'
      ? () => validateProtocolExpression(input)
      : () => validateProtocolSemanticQuery(input);
    expectExpressionError(action, fixture.error);
  });

  it('covers every datasets operator, formula helper, aggregation, and grain', () => {
    const ids = success.expressions.map(fixture => fixture.id);
    expect(ids.filter(id => id.startsWith('binary-')).sort()).toEqual([
      'binary-add', 'binary-divide', 'binary-multiply', 'binary-subtract',
    ]);
    expect(ids.filter(id => id.startsWith('call-')).sort()).toEqual([
      'call-ceil', 'call-coalesce', 'call-floor', 'call-nullIfZero', 'call-round',
    ]);
    expect(ids.filter(id => id.startsWith('comparison-')).sort()).toEqual([
      'comparison-between', 'comparison-eq', 'comparison-gt', 'comparison-gte',
      'comparison-in', 'comparison-like', 'comparison-lt', 'comparison-lte',
      'comparison-neq', 'comparison-notIn',
    ]);
    expect(ids.filter(id => id.startsWith('aggregate-') && id !== 'aggregate-median-normalized').sort())
      .toEqual([
        'aggregate-argMax', 'aggregate-argMin', 'aggregate-avg', 'aggregate-count',
        'aggregate-countDistinct', 'aggregate-max', 'aggregate-min',
        'aggregate-percentile', 'aggregate-stddev', 'aggregate-sum-filtered',
        'aggregate-variance',
      ]);
    const grains = success.queries
      .map(fixture => (fixture.value as { by?: string }).by)
      .filter((grain): grain is string => grain !== undefined);
    expect([...new Set(grains)].sort()).toEqual(['day', 'month', 'quarter', 'week', 'year']);
  });

  it('returns detached, deeply immutable snapshots', () => {
    const input = {
      kind: 'binary', operator: 'add',
      left: { kind: 'reference', name: 'revenue' },
      right: { kind: 'literal', value: 1.5 },
    };
    const validated = validateProtocolExpression(input);
    input.left.name = 'changed';
    expect(validated).toMatchObject({ left: { name: 'revenue' } });
    expect(Object.isFrozen(validated)).toBe(true);
    expect(Object.isFrozen((validated as { left: object }).left)).toBe(true);
  });

  it('permits products to lower but not raise protocol limits', () => {
    expectExpressionError(
      () => validateProtocolExpression(
        { kind: 'logical', operator: 'and', operands: [literal(), literal()] },
        { limits: { maxCollectionItems: 1 } },
      ),
      'HQ_EXPRESSION_TOO_MANY_ITEMS',
    );
    expect(() => validateProtocolExpression(literal(), { limits: { maxNodes: 1_001 } }))
      .toThrow(RangeError);
  });

  it('applies the same expression-depth boundary to standalone and query filters', () => {
    const atMaximumDepth = nestedPredicate(14);
    const overMaximumDepth = nestedPredicate(15);

    expect(() => validateProtocolExpression(atMaximumDepth)).not.toThrow();
    expect(() => validateProtocolSemanticQuery({
      kind: 'dataset', dataset: 'orders', filters: [atMaximumDepth],
    })).not.toThrow();

    expectExpressionError(
      () => validateProtocolExpression(overMaximumDepth),
      'HQ_EXPRESSION_TOO_DEEP',
    );
    expectExpressionError(
      () => validateProtocolSemanticQuery({
        kind: 'dataset', dataset: 'orders', filters: [overMaximumDepth],
      }),
      'HQ_EXPRESSION_TOO_DEEP',
    );
  });
});
