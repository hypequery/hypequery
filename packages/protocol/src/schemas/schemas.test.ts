import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ProtocolSchemaError, validateProtocolSchema } from './index.js';

interface SuccessFixture { id: string; value: unknown }
interface RejectionFixture {
  id: string;
  value?: unknown;
  generator?:
    | { type: 'nested-array'; depth: number }
    | { type: 'union-tree' }
    | { type: 'enum-values'; count: number }
    | { type: 'description'; bytes: number }
    | { type: 'unsafe-accessor' };
  error: string;
}

const FAILURE_CODES = [
  'HQ_SCHEMA_TYPE', 'HQ_SCHEMA_UNKNOWN_FIELD', 'HQ_SCHEMA_UNKNOWN_KIND',
  'HQ_SCHEMA_INVALID_IDENTIFIER', 'HQ_SCHEMA_INVALID_VALUE',
  'HQ_SCHEMA_INVALID_CONSTRAINT', 'HQ_SCHEMA_INVALID_REQUIRED',
  'HQ_SCHEMA_DUPLICATE_VALUE', 'HQ_SCHEMA_TOO_DEEP',
  'HQ_SCHEMA_TOO_MANY_NODES', 'HQ_SCHEMA_TOO_MANY_ITEMS',
  'HQ_SCHEMA_TOO_LARGE', 'HQ_SCHEMA_UNSAFE_OBJECT',
] as const;

function readFixture<T>(name: string): T {
  const path = fileURLToPath(new URL(
    `../../../../specs/security-protocol/fixtures/query-schemas-v1/${name}`,
    import.meta.url,
  ));
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function materialize(fixture: RejectionFixture): unknown {
  if (!fixture.generator) return fixture.value;
  const generator = fixture.generator;
  switch (generator.type) {
    case 'nested-array': {
      let value: unknown = { kind: 'any' };
      for (let index = 0; index < generator.depth; index += 1) {
        value = { kind: 'array', items: value };
      }
      return value;
    }
    case 'union-tree': {
      const groups = Array.from({ length: 10 }, () => ({
        kind: 'union',
        variants: Array.from({ length: 100 }, () => ({ kind: 'any' })),
      }));
      return { kind: 'union', variants: groups };
    }
    case 'enum-values':
      return { kind: 'enum', values: Array.from({ length: generator.count }, (_, index) => `v${index}`) };
    case 'description':
      return { kind: 'string', description: 'a'.repeat(generator.bytes) };
    case 'unsafe-accessor': {
      const value = {} as { kind?: string };
      Object.defineProperty(value, 'kind', { enumerable: true, get: () => 'string' });
      return value;
    }
  }
}

function expectSchemaError(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error('Expected schema validation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(ProtocolSchemaError);
    expect((error as ProtocolSchemaError).code).toBe(code);
  }
}

describe('portable query schemas', () => {
  const success = readFixture<SuccessFixture[]>('success.json');
  const rejections = readFixture<RejectionFixture[]>('rejections.json');

  it('has unique fixture IDs and covers every stable failure code', () => {
    const fixtures = [...success, ...rejections];
    expect(new Set(fixtures.map(fixture => fixture.id)).size).toBe(fixtures.length);
    expect([...new Set(rejections.map(fixture => fixture.error))].sort())
      .toEqual([...FAILURE_CODES].sort());
  });

  it.each(success)('accepts $id', ({ value }) => {
    expect(validateProtocolSchema(value)).toEqual(value);
  });

  it.each(rejections)('rejects $id with its stable code', fixture => {
    expectSchemaError(() => validateProtocolSchema(materialize(fixture)), fixture.error);
  });

  it('covers every portable schema kind and object unknown-property policy', () => {
    const values = success.map(fixture => fixture.value as { kind: string; unknownProperties?: string });
    expect([...new Set(values.map(value => value.kind))].sort()).toEqual([
      'any', 'array', 'boolean', 'enum', 'integer', 'literal', 'null', 'number',
      'object', 'record', 'string', 'union', 'void',
    ]);
    expect(values
      .map(value => value.unknownProperties)
      .filter((value): value is string => value !== undefined)
      .sort()).toEqual(['preserve', 'reject', 'strip']);
  });

  it('rejects conflicting, fractional integer, and negative collection bounds', () => {
    for (const value of [
      { kind: 'number', minimum: 0.5, exclusiveMinimum: 1.5 },
      { kind: 'integer', minimum: 0.5 },
      { kind: 'string', minLength: -1 },
      { kind: 'array', items: { kind: 'any' }, maxItems: -1 },
    ]) {
      expectSchemaError(() => validateProtocolSchema(value), 'HQ_SCHEMA_INVALID_CONSTRAINT');
    }
  });

  it('requires defaults to satisfy the complete schema', () => {
    for (const value of [
      { kind: 'integer', minimum: 1, default: 0 },
      { kind: 'string', minLength: 2, default: 'a' },
      { kind: 'string', description: 'a'.repeat(65_537) },
      { kind: 'literal', value: true, default: false },
      { kind: 'enum', values: ['one', 'two'], default: 'three' },
      {
        kind: 'array',
        items: { kind: 'string' },
        default: { $hypequery: { type: 'array', version: 1, values: [1.5] } },
      },
    ]) {
      const expectedCode = 'description' in value ? 'HQ_SCHEMA_TOO_LARGE' : 'HQ_SCHEMA_INVALID_VALUE';
      expectSchemaError(() => validateProtocolSchema(value), expectedCode);
    }
  });

  it('rejects strip-policy defaults containing unknown properties', () => {
    expectSchemaError(() => validateProtocolSchema({
      kind: 'object',
      properties: { known: { kind: 'string' } },
      required: [],
      unknownProperties: 'strip',
      default: {
        $hypequery: {
          type: 'map',
          version: 1,
          entries: [['unknown', 'value']],
        },
      },
    }), 'HQ_SCHEMA_INVALID_VALUE');
  });

  it('rejects object defaults with duplicate property names', () => {
    expectSchemaError(() => validateProtocolSchema({
      kind: 'object',
      properties: { known: { kind: 'string' } },
      required: ['known'],
      unknownProperties: 'reject',
      default: {
        $hypequery: {
          type: 'map',
          version: 1,
          entries: [['known', 'first'], ['known', 'second']],
        },
      },
    }), 'HQ_SCHEMA_INVALID_VALUE');
  });

  it('returns detached, deeply immutable snapshots', () => {
    const input = {
      kind: 'object',
      properties: { name: { kind: 'string' } },
      required: ['name'],
      unknownProperties: 'reject',
    };
    const schema = validateProtocolSchema(input);
    input.properties.name.kind = 'number';
    expect(schema).toMatchObject({ properties: { name: { kind: 'string' } } });
    expect(Object.isFrozen(schema)).toBe(true);
    expect(Object.isFrozen((schema as { properties: object }).properties)).toBe(true);
    expect(Object.isFrozen((schema as { required: object }).required)).toBe(true);
  });

  it('permits lower product limits but rejects raised limits', () => {
    expectSchemaError(
      () => validateProtocolSchema(
        { kind: 'object', properties: { one: { kind: 'any' }, two: { kind: 'any' } }, required: [], unknownProperties: 'reject' },
        { limits: { maxCollectionItems: 1 } },
      ),
      'HQ_SCHEMA_TOO_MANY_ITEMS',
    );
    expect(() => validateProtocolSchema({ kind: 'any' }, { limits: { maxNodes: 1_001 } }))
      .toThrow(RangeError);
  });

  it('ignores explicitly undefined schema limits', () => {
    expect(validateProtocolSchema(
      { kind: 'any' },
      { limits: { maxDepth: undefined, maxNodes: undefined } },
    )).toEqual({ kind: 'any' });
  });
});
