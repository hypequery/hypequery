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
