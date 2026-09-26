import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ProtocolExpressionError,
  validateProtocolExpression,
  validateProtocolSemanticQuery,
  type ProtocolExpressionOptions,
} from './index.js';

interface FixtureEntry { id: string; value?: unknown; generator?: { type: string; count?: number } }
interface SuccessFixtures { expressions: FixtureEntry[]; queries: FixtureEntry[] }
interface RejectionFixture extends FixtureEntry { mode: 'expression' | 'query'; error: string }

function readFixture<T>(family: string, name: string): T {
  const path = fileURLToPath(new URL(
    `../../../../specs/security-protocol/fixtures/${family}/${name}`,
    import.meta.url,
  ));
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

const V2: ProtocolExpressionOptions = { extension: 2 };

function input(entry: FixtureEntry): unknown {
  if (entry.value !== undefined) return entry.value;
  if (entry.generator?.type === 'segments') {
    return {
      kind: 'dataset',
      dataset: 'orders',
      segments: Array.from({ length: entry.generator.count ?? 0 }, (_, index) => `s${index}`),
    };
  }
  return undefined;
}

function errorCode(run: () => unknown): string | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    if (error instanceof ProtocolExpressionError) return error.code;
    throw error;
  }
}

const v1Success = readFixture<SuccessFixtures>('expressions-v1', 'success.json');
const v2Success = readFixture<SuccessFixtures>('expressions-v2', 'success.json');
const v2Rejections = readFixture<RejectionFixture[]>('expressions-v2', 'rejections.json');

describe('expression extension 2', () => {
  it('accepts every extension 1 success case unchanged (strict superset)', () => {
    for (const entry of v1Success.expressions.filter((item) => item.value !== undefined)) {
      expect(validateProtocolExpression(entry.value, V2), entry.id)
        .toEqual(validateProtocolExpression(entry.value));
    }
    for (const entry of v1Success.queries) {
      expect(validateProtocolSemanticQuery(entry.value, V2), entry.id)
        .toEqual(validateProtocolSemanticQuery(entry.value));
    }
  });

  it('accepts the expressions-v2 success fixtures', () => {
    for (const entry of v2Success.expressions) {
      expect(() => validateProtocolExpression(entry.value, V2), entry.id).not.toThrow();
    }
    for (const entry of v2Success.queries) {
      expect(() => validateProtocolSemanticQuery(entry.value, V2), entry.id).not.toThrow();
    }
  });

  it('rejects the expressions-v2 rejection fixtures with their stable codes', () => {
    for (const entry of v2Rejections) {
      const validate = entry.mode === 'query' ? validateProtocolSemanticQuery : validateProtocolExpression;
      expect(errorCode(() => validate(input(entry), V2)), entry.id).toBe(entry.error);
    }
  });

  it('keeps every extension 2 addition out of extension 1', () => {
    expect(errorCode(() => validateProtocolExpression(
      { kind: 'aggregate', aggregation: 'approxCountDistinct', field: 'user_id' },
    ))).toBe('HQ_EXPRESSION_INVALID_AGGREGATION');
    expect(errorCode(() => validateProtocolSemanticQuery({ kind: 'dataset', dataset: 'e', by: 'minute' })))
      .toBe('HQ_EXPRESSION_INVALID_QUERY');
    expect(errorCode(() => validateProtocolSemanticQuery({ kind: 'dataset', dataset: 'o', segments: [] })))
      .toBe('HQ_EXPRESSION_UNKNOWN_FIELD');
    expect(errorCode(() => validateProtocolSemanticQuery(
      { kind: 'dataset', dataset: 'o', measures: ['customer.customerCount'] },
    ))).toBe('HQ_EXPRESSION_INVALID_IDENTIFIER');
  });

  it('returns segments as a frozen snapshot in authored order', () => {
    const segments = ['b', 'a'];
    const query = validateProtocolSemanticQuery({ kind: 'dataset', dataset: 'o', segments }, V2);
    segments.push('c');
    expect(query.segments).toEqual(['b', 'a']);
    expect(Object.isFrozen(query.segments)).toBe(true);
  });

  it('rejects an unsupported extension option', () => {
    expect(() => validateProtocolExpression({ kind: 'reference', name: 'x' }, { extension: 3 as never }))
      .toThrow(RangeError);
  });
});
