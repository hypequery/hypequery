import { validateProtocolSchema, type ProtocolSchema } from '@hypequery/protocol';
import { isZod4Schema, type AnyZodSchema } from './utils/zod-schema-version.js';
import { convertZodV3Schema } from './utils/zod-v3-protocol-schema.js';
import { convertZodV4Schema } from './utils/zod-v4-protocol-schema.js';

export { ProtocolSchemaAdapterError } from './utils/protocol-schema-conversion.js';

/**
 * Converts the portable subset of a Zod schema into RFC 0004. Accepts schemas
 * from Zod 3 or Zod 4, so a caller's own copy of Zod need not match ours.
 */
export function zodToProtocolSchema(
  schema: AnyZodSchema | undefined,
  path = '$',
): ProtocolSchema {
  if (schema === undefined) return validateProtocolSchema({ kind: 'any' });
  return validateProtocolSchema(isZod4Schema(schema)
    ? convertZodV4Schema(schema, path)
    : convertZodV3Schema(schema as Parameters<typeof convertZodV3Schema>[0], path));
}
