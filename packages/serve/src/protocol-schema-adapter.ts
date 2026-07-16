import type { ZodTypeAny } from 'zod';
import {
  validateCanonicalValue,
  validateProtocolSchema,
  type CanonicalValue,
  type ProtocolSchema,
} from '@hypequery/protocol';

export class ProtocolSchemaAdapterError extends TypeError {
  readonly path: string;

  constructor(message: string, path = '$') {
    super(`${message} at ${path}`);
    this.name = 'ProtocolSchemaAdapterError';
    this.path = path;
  }
}

function canonicalValue(input: unknown, path: string): CanonicalValue {
  try {
    if (Array.isArray(input)) {
      return validateCanonicalValue({
        $hypequery: {
          type: 'array',
          version: 1,
          values: input.map((item, index) => canonicalValue(item, `${path}[${index}]`)),
        },
      });
    }
    if (typeof input === 'object' && input !== null) {
      if ('$hypequery' in input) return validateCanonicalValue(input);
      const prototype = Object.getPrototypeOf(input);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new ProtocolSchemaAdapterError('Default is not portable plain data', path);
      }
      return validateCanonicalValue({
        $hypequery: {
          type: 'map',
          version: 1,
          entries: Object.entries(input as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, value]) => [key, canonicalValue(value, `${path}.${key}`)]),
        },
      });
    }
    return validateCanonicalValue(input);
  } catch (error) {
    if (error instanceof ProtocolSchemaAdapterError) throw error;
    throw new ProtocolSchemaAdapterError('Default is not a canonical protocol value', path);
  }
}

function typeName(schema: ZodTypeAny): string {
  return String((schema as any)?._def?.typeName ?? 'Unknown');
}

function description(schema: ZodTypeAny): string | undefined {
  return typeof (schema as any).description === 'string'
    ? (schema as any).description
    : undefined;
}

function annotate(schema: ZodTypeAny, result: Record<string, unknown>): Record<string, unknown> {
  const value = description(schema);
  return value === undefined ? result : { ...result, description: value };
}

function convertString(schema: ZodTypeAny, path: string): Record<string, unknown> {
  const result: Record<string, unknown> = { kind: 'string' };
  for (const check of (schema as any)._def.checks as Array<Record<string, unknown>>) {
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
  return annotate(schema, result);
}

function convertNumber(schema: ZodTypeAny, path: string): Record<string, unknown> {
  const result: Record<string, unknown> = { kind: 'number' };
  for (const check of (schema as any)._def.checks as Array<Record<string, unknown>>) {
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
  return annotate(schema, result);
}

function isOptionalProperty(schema: ZodTypeAny): boolean {
  const name = typeName(schema);
  return name === 'ZodOptional' || name === 'ZodDefault';
}

function nativeEnumValues(input: Record<string, string | number>): readonly (string | number)[] {
  const values = Object.keys(input)
    .filter(key => typeof input[String(input[key])] !== 'number')
    .map(key => input[key]);
  return [...new Set(values)];
}

function isUnconstrainedRecordKey(schema: ZodTypeAny | undefined): boolean {
  if (schema === undefined || typeName(schema) !== 'ZodString') return false;
  const definition = (schema as any)._def as Record<string, unknown>;
  return Array.isArray(definition.checks)
    && definition.checks.length === 0
    && definition.coerce !== true;
}

function convert(schema: ZodTypeAny, path: string): Record<string, unknown> {
  const definition = (schema as any)._def as Record<string, any>;
  switch (typeName(schema)) {
    case 'ZodAny':
    case 'ZodUnknown':
      return annotate(schema, { kind: 'any' });
    case 'ZodNever':
    case 'ZodVoid':
    case 'ZodUndefined':
      return annotate(schema, { kind: 'void' });
    case 'ZodNull':
      return annotate(schema, { kind: 'null' });
    case 'ZodBoolean':
      return annotate(schema, { kind: 'boolean' });
    case 'ZodString':
      return convertString(schema, path);
    case 'ZodNumber':
      return convertNumber(schema, path);
    case 'ZodLiteral':
      return annotate(schema, {
        kind: 'literal',
        value: canonicalValue(definition.value, `${path}.value`),
      });
    case 'ZodEnum':
      return annotate(schema, {
        kind: 'enum',
        values: [...definition.values],
      });
    case 'ZodNativeEnum': {
      const values = nativeEnumValues(definition.values);
      return annotate(schema, { kind: 'enum', values });
    }
    case 'ZodArray': {
      const result: Record<string, unknown> = {
        kind: 'array',
        items: convert(definition.type, `${path}.items`),
      };
      if (definition.minLength?.value !== undefined) result.minItems = definition.minLength.value;
      if (definition.maxLength?.value !== undefined) result.maxItems = definition.maxLength.value;
      if (definition.exactLength?.value !== undefined) {
        result.minItems = definition.exactLength.value;
        result.maxItems = definition.exactLength.value;
      }
      return annotate(schema, result);
    }
    case 'ZodObject': {
      if (typeName(definition.catchall) !== 'ZodNever') {
        throw new ProtocolSchemaAdapterError('Unsupported Zod object catchall', path);
      }
      const shape = definition.shape() as Record<string, ZodTypeAny>;
      const properties = Object.fromEntries(
        Object.entries(shape).map(([name, property]) => [
          name,
          convert(property, `${path}.properties.${name}`),
        ]),
      );
      const required = Object.entries(shape)
        .filter(([, property]) => !isOptionalProperty(property))
        .map(([name]) => name);
      const unknownProperties = definition.unknownKeys === 'passthrough'
        ? 'preserve'
        : definition.unknownKeys === 'strict'
          ? 'reject'
          : 'strip';
      return annotate(schema, {
        kind: 'object',
        properties,
        required,
        unknownProperties,
      });
    }
    case 'ZodRecord':
      if (!isUnconstrainedRecordKey(definition.keyType)) {
        throw new ProtocolSchemaAdapterError('Unsupported constrained Zod record key', path);
      }
      return annotate(schema, {
        kind: 'record',
        values: convert(definition.valueType, `${path}.values`),
      });
    case 'ZodUnion':
      return annotate(schema, {
        kind: 'union',
        variants: definition.options.map((option: ZodTypeAny, index: number) =>
          convert(option, `${path}.variants[${index}]`)),
      });
    case 'ZodDiscriminatedUnion':
      // RFC 0004 has no separate discriminator index. Converting every option
      // drops only Zod's lookup metadata; each object's literal discriminator
      // property remains part of its protocol variant.
      return annotate(schema, {
        kind: 'union',
        variants: [...definition.options.values()].map((option: ZodTypeAny, index: number) =>
          convert(option, `${path}.variants[${index}]`)),
      });
    case 'ZodNullable':
      return annotate(schema, {
        kind: 'union',
        variants: [convert(definition.innerType, `${path}.variants[0]`), { kind: 'null' }],
      });
    case 'ZodOptional':
      return annotate(schema, convert(definition.innerType, path));
    case 'ZodDefault': {
      const inner = convert(definition.innerType, path);
      if (inner.kind === 'void') {
        throw new ProtocolSchemaAdapterError('Void schemas cannot carry defaults', path);
      }
      return annotate(schema, {
        ...inner,
        default: canonicalValue(definition.defaultValue(), `${path}.default`),
      });
    }
    case 'ZodBranded':
      return annotate(schema, convert(definition.type, path));
    case 'ZodReadonly':
      return annotate(schema, convert(definition.innerType, path));
    default:
      throw new ProtocolSchemaAdapterError(`Unsupported Zod type "${typeName(schema)}"`, path);
  }
}

/** Converts the portable subset of a Zod v3 schema into RFC 0004. */
export function zodToProtocolSchema(
  schema: ZodTypeAny | undefined,
  path = '$',
): ProtocolSchema {
  if (schema === undefined) return validateProtocolSchema({ kind: 'any' });
  return validateProtocolSchema(convert(schema, path));
}
