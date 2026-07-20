import { describe, expect, it } from 'vitest';
import {
  applyProtocolSchemaValue,
  createProtocolSchemaValueParser,
  ProtocolSchemaValueError,
  resolveProtocolSchemaValueLimits,
  validateProtocolSchema,
} from './index.js';

describe('protocol schema values', () => {
  it('applies defaults and object unknown-property policies to detached values', () => {
    const schema = validateProtocolSchema({
      kind: 'object',
      properties: {
        name: { kind: 'string', minLength: 1 },
        enabled: { kind: 'boolean', default: false },
      },
      required: ['name'],
      unknownProperties: 'strip',
    });

    const value = applyProtocolSchemaValue(schema, { name: 'Ada', extra: true });

    expect(value).toEqual({ name: 'Ada', enabled: false });
    expect(Object.getPrototypeOf(value)).toBe(null);
    expect(Object.isFrozen(value)).toBe(true);
  });

  it('applies composite canonical defaults as ordinary wire values', () => {
    const value = applyProtocolSchemaValue({
      kind: 'array',
      items: { kind: 'integer' },
      default: {
        $hypequery: {
          type: 'array',
          version: 1,
          values: [1, 2],
        },
      },
    }, undefined);

    expect(value).toEqual([1, 2]);
    expect(Object.isFrozen(value)).toBe(true);
  });

  it('supports records, unions, literals, and enums', () => {
    const parser = createProtocolSchemaValueParser({
      kind: 'record',
      values: {
        kind: 'union',
        variants: [
          { kind: 'literal', value: 'ready' },
          { kind: 'enum', values: [1, 2] },
        ],
      },
    });

    expect(parser.parse({ first: 'ready', second: 2 })).toEqual({ first: 'ready', second: 2 });
    expect(() => parser.parse({ first: 3 })).toThrow(ProtocolSchemaValueError);
  });

  it('enforces scalar and collection constraints with exact paths', () => {
    const parser = createProtocolSchemaValueParser(validateProtocolSchema({
      kind: 'object',
      properties: {
        names: { kind: 'array', items: { kind: 'string', minLength: 2 }, minItems: 1 },
      },
      required: ['names'],
      unknownProperties: 'reject',
    }));

    expect(() => parser.parse({ names: ['x'] })).toThrow(expect.objectContaining({
      code: 'HQ_SCHEMA_VALUE_INVALID',
      path: '$.names[0]',
    }));
    expect(() => parser.parse({ names: ['ok'], extra: true })).toThrow(expect.objectContaining({
      path: '$.extra',
    }));
  });

  it.each([
    { kind: 'any' } as const,
    {
      kind: 'object',
      properties: {},
      required: [],
      unknownProperties: 'preserve',
    } as const,
    { kind: 'record', values: { kind: 'any' } } as const,
  ])('reports oversized property keys at their derived path for $kind schemas', schema => {
    const parser = createProtocolSchemaValueParser(schema, { limits: { maxStringBytes: 8 } });
    const oversized = 'x'.repeat(129);

    expect(() => parser.parse({ [oversized]: true })).toThrow(expect.objectContaining({
      path: '$.*',
    }));
  });

  it('rejects unsafe values and cycles', () => {
    const parser = createProtocolSchemaValueParser({ kind: 'any' });
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const accessor = Object.defineProperty({}, 'value', { enumerable: true, get: () => 1 });
    const sparse = new Array(1);

    expect(() => parser.parse(cycle)).toThrow(ProtocolSchemaValueError);
    expect(() => parser.parse(accessor)).toThrow(ProtocolSchemaValueError);
    expect(() => parser.parse(sparse)).toThrow(ProtocolSchemaValueError);
    expect(() => parser.parse(new Date())).toThrow(ProtocolSchemaValueError);
  });

  it('enforces value budgets across union attempts', () => {
    const parser = createProtocolSchemaValueParser({
      kind: 'union',
      variants: [{ kind: 'string' }, { kind: 'array', items: { kind: 'integer' } }],
    }, { limits: { maxNodes: 3 } });

    expect(() => parser.parse([1, 2])).toThrow(ProtocolSchemaValueError);
  });

  it('retains ancestor cycle detection across union attempts', () => {
    const parser = createProtocolSchemaValueParser(validateProtocolSchema({
      kind: 'object',
      properties: {
        child: {
          kind: 'union',
          variants: [{
            kind: 'object',
            properties: { parent: { kind: 'any' } },
            required: ['parent'],
            unknownProperties: 'reject',
          }, {
            kind: 'object',
            properties: {},
            required: [],
            unknownProperties: 'strip',
          }],
        },
      },
      required: ['child'],
      unknownProperties: 'reject',
    }), { limits: { maxNodes: 6 } });
    const input: { child: { parent?: unknown } } = { child: {} };
    input.child.parent = input;

    expect(parser.parse(input)).toEqual({ child: {} });
  });

  it('treats explicit undefined limits as absent', () => {
    expect(resolveProtocolSchemaValueLimits({ limits: { maxDepth: undefined } }))
      .toMatchObject({ maxDepth: 32 });
  });

  it('parses duplicate-aware JSON before applying the schema', () => {
    const parser = createProtocolSchemaValueParser(validateProtocolSchema({
      kind: 'object',
      properties: { id: { kind: 'string' } },
      required: ['id'],
      unknownProperties: 'reject',
    }));

    expect(parser.parseJson?.('{"id":"one"}')).toEqual({ id: 'one' });
    expect(() => parser.parseJson?.('{"id":"one","id":"two"}')).toThrow(expect.objectContaining({
      code: 'HQ_VALUE_DUPLICATE_KEY',
    }));
  });
});
