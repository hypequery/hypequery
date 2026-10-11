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

type ZodDefinition = Record<string, any>;
type ZodCheck = Record<string, any>;

function definitionOf(schema: ZodTypeAny): ZodDefinition {
  return (schema as any)?._zod?.def ?? {};
}

function typeName(schema: ZodTypeAny): string {
  return String(definitionOf(schema).type ?? 'unknown');
}

/**
 * Zod 4 stores refinements as `custom` checks on the refined schema itself.
 * A refinement preserves the schema's input and output shape: the rule stays
 * enforced by Zod but cannot be advertised by ProtocolSchema (for example, a
 * cross-field selection requirement), so it is skipped here.
 */
function portableChecks(schema: ZodTypeAny): ZodCheck[] {
  const checks = (definitionOf(schema).checks ?? []) as Array<{ _zod: { def: ZodCheck } }>;
  return checks
    .map(check => check._zod.def)
    .filter(check => check.check !== 'custom');
}

function checkLabel(check: ZodCheck): string {
  return String(check.format ?? check.check);
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
  for (const check of portableChecks(schema)) {
    switch (check.check) {
      case 'min_length':
        result.minLength = check.minimum;
        break;
      case 'max_length':
        result.maxLength = check.maximum;
        break;
      case 'length_equals':
        result.minLength = check.length;
        result.maxLength = check.length;
        break;
      default:
        throw new ProtocolSchemaAdapterError(`Unsupported Zod string check "${checkLabel(check)}"`, path);
    }
  }
  return annotate(schema, result);
}

function convertNumber(schema: ZodTypeAny, path: string): Record<string, unknown> {
  const result: Record<string, unknown> = { kind: 'number' };
  for (const check of portableChecks(schema)) {
    switch (check.check) {
      case 'number_format':
        if (check.format !== 'safeint') {
          throw new ProtocolSchemaAdapterError(`Unsupported Zod number check "${checkLabel(check)}"`, path);
        }
        result.kind = 'integer';
        break;
      case 'greater_than':
        result[check.inclusive === false ? 'exclusiveMinimum' : 'minimum'] = check.value;
        break;
      case 'less_than':
        result[check.inclusive === false ? 'exclusiveMaximum' : 'maximum'] = check.value;
        break;
      default:
        throw new ProtocolSchemaAdapterError(`Unsupported Zod number check "${checkLabel(check)}"`, path);
    }
  }
  return annotate(schema, result);
}

function convertArray(schema: ZodTypeAny, definition: ZodDefinition, path: string): Record<string, unknown> {
  const result: Record<string, unknown> = {
    kind: 'array',
    items: convert(definition.element, `${path}.items`),
  };
  for (const check of portableChecks(schema)) {
    switch (check.check) {
      case 'min_length':
        result.minItems = check.minimum;
        break;
      case 'max_length':
        result.maxItems = check.maximum;
        break;
      case 'length_equals':
        result.minItems = check.length;
        result.maxItems = check.length;
        break;
      default:
        throw new ProtocolSchemaAdapterError(`Unsupported Zod array check "${checkLabel(check)}"`, path);
    }
  }
  return annotate(schema, result);
}

function isOptionalProperty(schema: ZodTypeAny): boolean {
  const name = typeName(schema);
  return name === 'optional' || name === 'default';
}

function isUnconstrainedRecordKey(schema: ZodTypeAny | undefined): boolean {
  if (schema === undefined || typeName(schema) !== 'string') return false;
  const definition = definitionOf(schema);
  return portableChecks(schema).length === 0 && definition.coerce !== true;
}

function unknownPropertiesPolicy(catchall: ZodTypeAny | undefined, path: string): string {
  if (catchall === undefined) return 'strip';
  switch (typeName(catchall)) {
    case 'never':
      return 'reject';
    case 'unknown':
      return 'preserve';
    default:
      throw new ProtocolSchemaAdapterError('Unsupported Zod object catchall', path);
  }
}

function pipeEffect(definition: ZodDefinition): string {
  if (typeName(definition.in) === 'transform') return 'preprocess';
  if (typeName(definition.out) === 'transform') return 'transform';
  return 'pipe';
}

function convert(schema: ZodTypeAny, path: string): Record<string, unknown> {
  const definition = definitionOf(schema);
  switch (typeName(schema)) {
    case 'any':
    case 'unknown':
      return annotate(schema, { kind: 'any' });
    case 'never':
    case 'void':
    case 'undefined':
      return annotate(schema, { kind: 'void' });
    case 'null':
      return annotate(schema, { kind: 'null' });
    case 'boolean':
      return annotate(schema, { kind: 'boolean' });
    case 'string':
      return convertString(schema, path);
    case 'number':
      return convertNumber(schema, path);
    case 'literal': {
      const values = definition.values as unknown[];
      if (values.length === 1) {
        return annotate(schema, {
          kind: 'literal',
          value: canonicalValue(values[0], `${path}.value`),
        });
      }
      return annotate(schema, {
        kind: 'union',
        variants: values.map((value, index) => ({
          kind: 'literal',
          value: canonicalValue(value, `${path}.variants[${index}].value`),
        })),
      });
    }
    case 'enum':
      // `options` drops the reverse mappings TypeScript adds to numeric enums.
      return annotate(schema, {
        kind: 'enum',
        values: [...new Set((schema as any).options as (string | number)[])],
      });
    case 'array':
      return convertArray(schema, definition, path);
    case 'object': {
      const unknownProperties = unknownPropertiesPolicy(definition.catchall, path);
      const shape = definition.shape as Record<string, ZodTypeAny>;
      const properties = Object.fromEntries(
        Object.entries(shape).map(([name, property]) => [
          name,
          convert(property, `${path}.properties.${name}`),
        ]),
      );
      const required = Object.entries(shape)
        .filter(([, property]) => !isOptionalProperty(property))
        .map(([name]) => name);
      return annotate(schema, {
        kind: 'object',
        properties,
        required,
        unknownProperties,
      });
    }
    case 'record':
      if (!isUnconstrainedRecordKey(definition.keyType)) {
        throw new ProtocolSchemaAdapterError('Unsupported constrained Zod record key', path);
      }
      return annotate(schema, {
        kind: 'record',
        values: convert(definition.valueType, `${path}.values`),
      });
    case 'union':
      // Discriminated unions are plain unions in Zod 4. RFC 0004 has no
      // separate discriminator index; each object's literal discriminator
      // property remains part of its protocol variant.
      return annotate(schema, {
        kind: 'union',
        variants: (definition.options as ZodTypeAny[]).map((option, index) =>
          convert(option, `${path}.variants[${index}]`)),
      });
    case 'nullable':
      return annotate(schema, {
        kind: 'union',
        variants: [convert(definition.innerType, `${path}.variants[0]`), { kind: 'null' }],
      });
    case 'optional':
    case 'readonly':
      return annotate(schema, convert(definition.innerType, path));
    case 'default': {
      const inner = convert(definition.innerType, path);
      if (inner.kind === 'void') {
        throw new ProtocolSchemaAdapterError('Void schemas cannot carry defaults', path);
      }
      return annotate(schema, {
        ...inner,
        default: canonicalValue(definition.defaultValue, `${path}.default`),
      });
    }
    case 'pipe':
      throw new ProtocolSchemaAdapterError(`Unsupported Zod effect "${pipeEffect(definition)}"`, path);
    default:
      throw new ProtocolSchemaAdapterError(`Unsupported Zod type "${typeName(schema)}"`, path);
  }
}

/** Converts the portable subset of a Zod 4 schema into RFC 0004. */
export function zodToProtocolSchema(
  schema: ZodTypeAny | undefined,
  path = '$',
): ProtocolSchema {
  if (schema === undefined) return validateProtocolSchema({ kind: 'any' });
  return validateProtocolSchema(convert(schema, path));
}
