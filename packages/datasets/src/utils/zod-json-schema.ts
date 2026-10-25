import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { isZod4Schema, type AnyZodSchema } from './zod-schema-version.js';

/**
 * Draft-07 JSON Schema for a Zod 3 or Zod 4 schema, describing what a caller
 * may send. `zod-to-json-schema` only reads Zod 3 (it returns an empty schema
 * for Zod 4), and Zod 4 ships its own generator.
 */
export function zodToDraft7JsonSchema(schema: AnyZodSchema): Record<string, unknown> {
  if (isZod4Schema(schema)) {
    return z.toJSONSchema(schema as unknown as z.ZodType, {
      target: 'draft-7',
      io: 'input',
      unrepresentable: 'any',
    }) as Record<string, unknown>;
  }
  return zodToJsonSchema(schema as never, { target: 'jsonSchema7', $refStrategy: 'none' }) as Record<string, unknown>;
}
