import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ProtocolQueryImplementationError,
  validateProtocolQueryImplementation,
  validateProtocolSqlExpression,
} from './index.js';

type Surface = 'query-implementation' | 'sql-expression';
interface SuccessFixture { id: string; surface: Surface; value: unknown }
interface RejectionFixture {
  id: string;
  surface: Surface;
  value?: unknown;
  generator?:
    | { type: 'parameters'; count: number }
    | { type: 'sql-expression'; bytes: number }
    | { type: 'unsafe-accessor' };
  error: string;
}

const FAILURE_CODES = [
  'HQ_QUERY_IMPLEMENTATION_TYPE',
  'HQ_QUERY_IMPLEMENTATION_UNKNOWN_FIELD',
  'HQ_QUERY_IMPLEMENTATION_UNKNOWN_KIND',
  'HQ_QUERY_IMPLEMENTATION_INVALID_IDENTIFIER',
  'HQ_QUERY_IMPLEMENTATION_INVALID_VALUE',
  'HQ_QUERY_IMPLEMENTATION_INVALID_REFERENCE',
  'HQ_QUERY_IMPLEMENTATION_TOO_MANY_ITEMS',
  'HQ_QUERY_IMPLEMENTATION_TOO_LARGE',
  'HQ_QUERY_IMPLEMENTATION_UNSAFE_OBJECT',
] as const;

function readFixture<T>(name: string): T {
  const path = fileURLToPath(new URL(
    `../../../../specs/security-protocol/fixtures/query-implementations-v1/${name}`,
    import.meta.url,
  ));
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function compiledSql(parameters: unknown[]) {
  return {
    kind: 'compiled-sql',
    dialect: 'clickhouse',
    operation: 'select',
    statement: 'SELECT 1',
    parameters,
    readSources: [],
    tenant: { kind: 'not-required' },
  };
}

function materialize(fixture: RejectionFixture): unknown {
  if (!fixture.generator) return fixture.value;
  switch (fixture.generator.type) {
    case 'parameters':
      return compiledSql(Array.from({ length: fixture.generator.count }, (_, index) => ({
        name: `param${index}`,
        source: { kind: 'input', path: `param${index}` },
        clickHouseType: 'String',
      })));
    case 'sql-expression':
      return {
        kind: 'sql-expression',
        dialect: 'clickhouse',
        sql: 'a'.repeat(fixture.generator.bytes),
        output: { kind: 'string' },
        dependencies: [],
      };
    case 'unsafe-accessor': {
      const value = {} as { kind?: string };
      Object.defineProperty(value, 'kind', { enumerable: true, get: () => 'semantic-plan' });
      return value;
    }
  }
}

function validate(surface: Surface, value: unknown): unknown {
  return surface === 'sql-expression'
    ? validateProtocolSqlExpression(value)
    : validateProtocolQueryImplementation(value);
}

function expectImplementationError(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error('Expected query implementation validation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(ProtocolQueryImplementationError);
    expect((error as ProtocolQueryImplementationError).code).toBe(code);
  }
}

describe('portable query implementations', () => {
  const success = readFixture<SuccessFixture[]>('success.json');
  const rejections = readFixture<RejectionFixture[]>('rejections.json');

  it('has unique fixture IDs and covers every stable failure code', () => {
    const fixtures = [...success, ...rejections];
    expect(new Set(fixtures.map(fixture => fixture.id)).size).toBe(fixtures.length);
    expect([...new Set(rejections.map(fixture => fixture.error))].sort())
      .toEqual([...FAILURE_CODES].sort());
  });

  it.each(success)('accepts $id', fixture => {
    expect(validate(fixture.surface, fixture.value)).toEqual(fixture.value);
  });

  it.each(rejections)('rejects $id with its stable code', fixture => {
    expectImplementationError(
      () => validate(fixture.surface, materialize(fixture)),
      fixture.error,
    );
  });

  it('covers every implementation kind and both runtime kinds', () => {
    const implementations = success
      .filter(fixture => fixture.surface === 'query-implementation')
      .map(fixture => fixture.value as { kind: string; runtime?: string });
    expect([...new Set(implementations.map(value => value.kind))].sort())
      .toEqual(['compiled-sql', 'runtime-reference', 'semantic-plan']);
    expect(implementations.flatMap(value => value.runtime ? [value.runtime] : []).sort())
      .toEqual(['node', 'python']);
  });

  it('returns detached, deeply immutable snapshots', () => {
    const input = compiledSql([{
      name: 'from',
      source: { kind: 'input', path: 'range.from' },
      clickHouseType: 'Date',
    }]);
    const result = validateProtocolQueryImplementation(input);
    (input.parameters[0] as { clickHouseType: string }).clickHouseType = 'String';
    expect(result).toMatchObject({ parameters: [{ clickHouseType: 'Date' }] });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen((result as { parameters: object }).parameters)).toBe(true);
  });

  it('requires tenant parameters and policy to agree exactly', () => {
    const tenantParameter = {
      name: 'tenantId', source: { kind: 'tenant' }, clickHouseType: 'UUID',
    };
    expectImplementationError(
      () => validateProtocolQueryImplementation(compiledSql([tenantParameter])),
      'HQ_QUERY_IMPLEMENTATION_INVALID_REFERENCE',
    );
    expectImplementationError(
      () => validateProtocolQueryImplementation({
        ...compiledSql([tenantParameter, {
          name: 'otherTenant', source: { kind: 'tenant' }, clickHouseType: 'UUID',
        }]),
        tenant: { kind: 'required', parameter: 'tenantId' },
      }),
      'HQ_QUERY_IMPLEMENTATION_INVALID_REFERENCE',
    );
  });

  it('allows multiline SQL but rejects controls in SQL and physical metadata', () => {
    expect(() => validateProtocolQueryImplementation({
      ...compiledSql([]), statement: 'SELECT\n  1',
    })).not.toThrow();
    for (const value of [
      { ...compiledSql([]), statement: 'SELECT\u00001' },
      { ...compiledSql([]), readSources: ['trips\narchive'] },
      compiledSql([{
        name: 'value', source: { kind: 'input', path: 'value' }, clickHouseType: 'String\u0085',
      }]),
    ]) {
      expectImplementationError(
        () => validateProtocolQueryImplementation(value),
        'HQ_QUERY_IMPLEMENTATION_INVALID_VALUE',
      );
    }
  });

  it('permits lower product limits but rejects raised limits', () => {
    expectImplementationError(
      () => validateProtocolQueryImplementation(compiledSql([]), { limits: { maxStatementBytes: 4 } }),
      'HQ_QUERY_IMPLEMENTATION_TOO_LARGE',
    );
    expect(() => validateProtocolQueryImplementation(compiledSql([]), {
      limits: { maxStatementBytes: 1_048_577 },
    })).toThrow(RangeError);
  });
});
