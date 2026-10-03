import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ProtocolSchemaAdapterError, zodToProtocolSchema } from './protocol-schema-adapter.js';

describe('zodToProtocolSchema effects', () => {
  it('unwraps refinements that preserve the schema shape', () => {
    expect(zodToProtocolSchema(z.string().refine(value => value.length > 0))).toEqual({
      kind: 'string',
    });
  });

  it('rejects transforms that can change the output shape', () => {
    expect(() => zodToProtocolSchema(z.string().transform(value => value.length)))
      .toThrow(new ProtocolSchemaAdapterError('Unsupported Zod effect "transform"'));
  });

  it('rejects preprocessors that can change the accepted input shape', () => {
    expect(() => zodToProtocolSchema(z.preprocess(value => String(value), z.string())))
      .toThrow(new ProtocolSchemaAdapterError('Unsupported Zod effect "preprocess"'));
  });
});

describe('portable schema contract', () => {
  it.each([
    [undefined, { kind: 'any' }],
    [z.any(), { kind: 'any' }],
    [z.unknown(), { kind: 'any' }],
    [z.never(), { kind: 'void' }],
    [z.void(), { kind: 'void' }],
    [z.undefined(), { kind: 'void' }],
    [z.null(), { kind: 'null' }],
    [z.boolean(), { kind: 'boolean' }],
    [z.literal('ready'), { kind: 'literal', value: 'ready' }],
    [z.enum(['a', 'b']), { kind: 'enum', values: ['a', 'b'] }],
    [z.nativeEnum({ A: 'a', B: 'b' }), { kind: 'enum', values: ['a', 'b'] }],
    [z.nativeEnum({ 0: 'A', 1: 'B', A: 0, B: 1 }), { kind: 'enum', values: [0, 1] }],
    [z.string().min(2).max(8).describe('label'), { kind: 'string', minLength: 2, maxLength: 8, description: 'label' }],
    [z.string().length(3), { kind: 'string', minLength: 3, maxLength: 3 }],
    [z.number().int().min(1).max(10).finite(), { kind: 'integer', minimum: 1, maximum: 10 }],
    [z.number().gt(1).lt(10), { kind: 'number', exclusiveMinimum: 1, exclusiveMaximum: 10 }],
    [z.array(z.boolean()).min(1).max(3), { kind: 'array', items: { kind: 'boolean' }, minItems: 1, maxItems: 3 }],
    [z.array(z.number()).length(2), { kind: 'array', items: { kind: 'number' }, minItems: 2, maxItems: 2 }],
    [z.record(z.string(), z.number()), { kind: 'record', values: { kind: 'number' } }],
    [z.union([z.string(), z.number()]), { kind: 'union', variants: [{ kind: 'string' }, { kind: 'number' }] }],
    [z.string().nullable(), { kind: 'union', variants: [{ kind: 'string' }, { kind: 'null' }] }],
    [z.string().optional().describe('optional'), { kind: 'string', description: 'optional' }],
    [z.string().brand('ID'), { kind: 'string' }],
    [z.string().readonly(), { kind: 'string' }],
  ])('converts %s without losing portable constraints', (schema, expected) => {
    expect(zodToProtocolSchema(schema)).toEqual(expected);
  });

  it.each(['strip', 'strict', 'passthrough'] as const)('preserves %s object policy and required fields', policy => {
    const schema = z.object({ id: z.string(), label: z.string().optional(), count: z.number().default(0) });
    expect(zodToProtocolSchema(schema[policy]())).toEqual({
      kind: 'object',
      properties: { id: { kind: 'string' }, label: { kind: 'string' }, count: { kind: 'number', default: 0 } },
      required: ['id'],
      unknownProperties: { strip: 'strip', strict: 'reject', passthrough: 'preserve' }[policy],
    });
  });

  it('retains literal discriminators in every union variant', () => {
    const variants = [z.object({ kind: z.literal('a') }), z.object({ kind: z.literal('b') })] as const;
    expect(zodToProtocolSchema(z.discriminatedUnion('kind', [...variants])))
      .toEqual(zodToProtocolSchema(z.union(variants)));
  });

  it('encodes nested defaults deterministically as canonical maps and arrays', () => {
    expect(zodToProtocolSchema(z.unknown().default({ z: [true, null], a: 'first' }))).toEqual({
      kind: 'any',
      default: { $hypequery: { type: 'map', version: 1, entries: [
        ['a', 'first'], ['z', { $hypequery: { type: 'array', version: 1, values: [true, null] } }],
      ] } },
    });
    const tagged = { $hypequery: { type: 'array', version: 1, values: [1] } };
    expect(zodToProtocolSchema(z.unknown().default(tagged))).toEqual({ kind: 'any', default: tagged });
  });

  it.each([
    [z.string().email(), 'Unsupported Zod string check'],
    [z.number().multipleOf(2), 'Unsupported Zod number check'],
    [z.object({}).catchall(z.string()), 'Unsupported Zod object catchall'],
    [z.record(z.string().min(1), z.number()), 'Unsupported constrained Zod record key'],
    [z.record(z.number(), z.number()), 'Unsupported constrained Zod record key'],
    [z.date(), 'Unsupported Zod type'],
    [z.void().default(undefined), 'Void schemas cannot carry defaults'],
    [z.unknown().default(new Date()), 'Default is not portable plain data'],
    [z.unknown().default(Number.POSITIVE_INFINITY), 'Default is not a canonical protocol value'],
  ])('rejects unsupported conversion %s with its property path', (schema, message) => {
    expect(() => zodToProtocolSchema(z.object({ value: schema }))).toThrow(message);
    try {
      zodToProtocolSchema(z.object({ value: schema }));
    } catch (error) {
      expect(error).toBeInstanceOf(ProtocolSchemaAdapterError);
      expect((error as ProtocolSchemaAdapterError).path).toMatch(/^\$\.properties\.value(?:\.default)?$/);
    }
  });
});
