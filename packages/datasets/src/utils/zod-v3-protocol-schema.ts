import {
  ProtocolSchemaAdapterError,
  annotate,
  canonicalValue,
  nativeEnumValues,
  withDefault,
  type ProtocolSchemaDraft,
} from './protocol-schema-conversion.js';

/** A Zod 3 schema, read through its `_def`. Callers may hold any 3.x copy of Zod. */
type ZodV3Schema = { readonly _def: Record<string, any>; readonly description?: string };

function typeName(schema: ZodV3Schema | undefined): string {
  return String(schema?._def?.typeName ?? 'Unknown');
}

function convertString(schema: ZodV3Schema, path: string): ProtocolSchemaDraft {
  const result: ProtocolSchemaDraft = { kind: 'string' };
  for (const check of schema._def.checks as Array<Record<string, unknown>>) {
    switch (check.kind) {
      case 'min':
        result.minLength = check.value;
        break;
      case 'max':
        result.maxLength = check.value;
        break;
      case 'length':
        result.minLength = check.value;
        result.maxLength = check.value;
        break;
      default:
        throw new ProtocolSchemaAdapterError(`Unsupported Zod string check "${String(check.kind)}"`, path);
    }
  }
  return annotate(schema.description, result);
}

function convertNumber(schema: ZodV3Schema, path: string): ProtocolSchemaDraft {
  const result: ProtocolSchemaDraft = { kind: 'number' };
  for (const check of schema._def.checks as Array<Record<string, unknown>>) {
    switch (check.kind) {
      case 'int':
        result.kind = 'integer';
        break;
      case 'min':
        result[check.inclusive === false ? 'exclusiveMinimum' : 'minimum'] = check.value;
        break;
      case 'max':
        result[check.inclusive === false ? 'exclusiveMaximum' : 'maximum'] = check.value;
        break;
      case 'finite':
        break;
      default:
        throw new ProtocolSchemaAdapterError(`Unsupported Zod number check "${String(check.kind)}"`, path);
    }
  }
  return annotate(schema.description, result);
}

function isOptionalProperty(schema: ZodV3Schema): boolean {
  const name = typeName(schema);
  return name === 'ZodOptional' || name === 'ZodDefault';
}

function isUnconstrainedRecordKey(schema: ZodV3Schema | undefined): boolean {
  if (schema === undefined || typeName(schema) !== 'ZodString') return false;
  const definition = schema._def;
  return Array.isArray(definition.checks)
    && definition.checks.length === 0
    && definition.coerce !== true;
}

/** Converts the portable subset of a Zod 3 schema into an RFC 0004 draft. */
export function convertZodV3Schema(schema: ZodV3Schema, path: string): ProtocolSchemaDraft {
  const definition = schema._def;
  const done = (result: ProtocolSchemaDraft) => annotate(schema.description, result);
  switch (typeName(schema)) {
    case 'ZodAny':
    case 'ZodUnknown':
      return done({ kind: 'any' });
    case 'ZodNever':
    case 'ZodVoid':
    case 'ZodUndefined':
      return done({ kind: 'void' });
    case 'ZodNull':
      return done({ kind: 'null' });
    case 'ZodBoolean':
      return done({ kind: 'boolean' });
    case 'ZodString':
      return convertString(schema, path);
    case 'ZodNumber':
      return convertNumber(schema, path);
    case 'ZodLiteral':
      return done({ kind: 'literal', value: canonicalValue(definition.value, `${path}.value`) });
    case 'ZodEnum':
      return done({ kind: 'enum', values: [...definition.values] });
    case 'ZodNativeEnum':
      return done({ kind: 'enum', values: nativeEnumValues(definition.values) });
    case 'ZodArray': {
      const result: ProtocolSchemaDraft = {
        kind: 'array',
        items: convertZodV3Schema(definition.type, `${path}.items`),
      };
      if (definition.minLength?.value !== undefined) result.minItems = definition.minLength.value;
      if (definition.maxLength?.value !== undefined) result.maxItems = definition.maxLength.value;
      if (definition.exactLength?.value !== undefined) {
        result.minItems = definition.exactLength.value;
        result.maxItems = definition.exactLength.value;
      }
      return done(result);
    }
    case 'ZodObject': {
      if (typeName(definition.catchall) !== 'ZodNever') {
        throw new ProtocolSchemaAdapterError('Unsupported Zod object catchall', path);
      }
      const shape = definition.shape() as Record<string, ZodV3Schema>;
      return done({
        kind: 'object',
        properties: Object.fromEntries(Object.entries(shape).map(([name, property]) => [
          name,
          convertZodV3Schema(property, `${path}.properties.${name}`),
        ])),
        required: Object.entries(shape)
          .filter(([, property]) => !isOptionalProperty(property))
          .map(([name]) => name),
        unknownProperties: definition.unknownKeys === 'passthrough'
          ? 'preserve'
          : definition.unknownKeys === 'strict'
            ? 'reject'
            : 'strip',
      });
    }
    case 'ZodRecord':
      if (!isUnconstrainedRecordKey(definition.keyType)) {
        throw new ProtocolSchemaAdapterError('Unsupported constrained Zod record key', path);
      }
      return done({ kind: 'record', values: convertZodV3Schema(definition.valueType, `${path}.values`) });
    case 'ZodUnion':
      return done({
        kind: 'union',
        variants: definition.options.map((option: ZodV3Schema, index: number) =>
          convertZodV3Schema(option, `${path}.variants[${index}]`)),
      });
    case 'ZodDiscriminatedUnion':
      // RFC 0004 has no separate discriminator index. Converting every option
      // drops only Zod's lookup metadata; each object's literal discriminator
      // property remains part of its protocol variant.
      return done({
        kind: 'union',
        variants: [...definition.options.values()].map((option: ZodV3Schema, index: number) =>
          convertZodV3Schema(option, `${path}.variants[${index}]`)),
      });
    case 'ZodNullable':
      return done({
        kind: 'union',
        variants: [convertZodV3Schema(definition.innerType, `${path}.variants[0]`), { kind: 'null' }],
      });
    case 'ZodOptional':
      return done(convertZodV3Schema(definition.innerType, path));
    case 'ZodDefault':
      return done(withDefault(convertZodV3Schema(definition.innerType, path), definition.defaultValue(), path));
    case 'ZodBranded':
      return done(convertZodV3Schema(definition.type, path));
    case 'ZodReadonly':
      return done(convertZodV3Schema(definition.innerType, path));
    case 'ZodEffects': {
      const effectType = String(definition.effect?.type ?? 'unknown');
      if (effectType !== 'refinement') {
        throw new ProtocolSchemaAdapterError(`Unsupported Zod effect "${effectType}"`, path);
      }
      // A refinement preserves the wrapped schema's input and output shape.
      // The rule itself remains enforced by Zod, but cannot be advertised by
      // ProtocolSchema (for example, a cross-field selection requirement).
      return done(convertZodV3Schema(definition.schema, path));
    }
    default:
      throw new ProtocolSchemaAdapterError(`Unsupported Zod type "${typeName(schema)}"`, path);
  }
}
