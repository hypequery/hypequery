import {
  ProtocolSchemaAdapterError,
  annotate,
  canonicalValue,
  nativeEnumValues,
  withDefault,
  type ProtocolSchemaDraft,
} from './protocol-schema-conversion.js';

/** A Zod 4 schema, read through `_zod.def`. Classic schemas also expose `description`. */
type ZodV4Schema = {
  readonly _zod: { readonly def: Record<string, any> };
  readonly description?: string;
};

type ZodV4Check = { readonly _zod: { readonly def: Record<string, any> } };

const INTEGER_FORMATS = new Set(['safeint', 'int32', 'uint32']);

function typeOf(schema: ZodV4Schema | undefined): string {
  return String(schema?._zod?.def?.type ?? 'unknown');
}

function checksOf(schema: ZodV4Schema): Array<Record<string, any>> {
  return ((schema._zod.def.checks ?? []) as ZodV4Check[]).map(check => check._zod.def);
}

/** Zod 4 stores `.refine()` as a `custom` check on the schema it refines. */
function isRefinement(check: Record<string, any>): boolean {
  return check.check === 'custom';
}

function applyLengthChecks(
  schema: ZodV4Schema,
  result: ProtocolSchemaDraft,
  keys: { min: string; max: string },
  label: string,
  path: string,
): ProtocolSchemaDraft {
  for (const check of checksOf(schema)) {
    switch (check.check) {
      case 'min_length':
        result[keys.min] = check.minimum;
        break;
      case 'max_length':
        result[keys.max] = check.maximum;
        break;
      case 'length_equals':
        result[keys.min] = check.length;
        result[keys.max] = check.length;
        break;
      default:
        if (isRefinement(check)) break;
        throw new ProtocolSchemaAdapterError(
          `Unsupported Zod ${label} check "${String(check.format ?? check.check)}"`,
          path,
        );
    }
  }
  return result;
}

function convertNumber(schema: ZodV4Schema, path: string): ProtocolSchemaDraft {
  const result: ProtocolSchemaDraft = { kind: 'number' };
  for (const check of checksOf(schema)) {
    switch (check.check) {
      case 'number_format':
        if (!INTEGER_FORMATS.has(check.format)) {
          throw new ProtocolSchemaAdapterError(`Unsupported Zod number check "${String(check.format)}"`, path);
        }
        result.kind = 'integer';
        break;
      case 'greater_than':
        result[check.inclusive ? 'minimum' : 'exclusiveMinimum'] = check.value;
        break;
      case 'less_than':
        result[check.inclusive ? 'maximum' : 'exclusiveMaximum'] = check.value;
        break;
      default:
        if (isRefinement(check)) break;
        throw new ProtocolSchemaAdapterError(`Unsupported Zod number check "${String(check.check)}"`, path);
    }
  }
  return result;
}

function isOptionalProperty(schema: ZodV4Schema): boolean {
  const type = typeOf(schema);
  return type === 'optional' || type === 'default';
}

function isUnconstrainedRecordKey(schema: ZodV4Schema | undefined): boolean {
  return schema !== undefined
    && typeOf(schema) === 'string'
    && checksOf(schema).length === 0
    && schema._zod.def.coerce !== true;
}

function unknownProperties(catchall: ZodV4Schema | undefined, path: string): string {
  if (catchall === undefined) return 'strip';
  switch (typeOf(catchall)) {
    case 'never':
      return 'reject';
    case 'unknown':
      return 'preserve';
    default:
      throw new ProtocolSchemaAdapterError('Unsupported Zod object catchall', path);
  }
}

function literal(values: readonly unknown[], path: string): ProtocolSchemaDraft {
  if (values.length === 1) {
    return { kind: 'literal', value: canonicalValue(values[0], `${path}.value`) };
  }
  return {
    kind: 'union',
    variants: values.map((value, index) => ({
      kind: 'literal',
      value: canonicalValue(value, `${path}.variants[${index}].value`),
    })),
  };
}

/**
 * Zod 4 has no effects wrapper: a transform is a pipe into a `transform`, and
 * a preprocessor is a pipe out of one. Neither preserves the advertised shape.
 */
function pipeEffect(definition: Record<string, any>): string {
  if (typeOf(definition.out) === 'transform') return 'transform';
  if (typeOf(definition.in) === 'transform') return 'preprocess';
  return 'pipe';
}

/** Converts the portable subset of a Zod 4 schema into an RFC 0004 draft. */
export function convertZodV4Schema(schema: ZodV4Schema, path: string): ProtocolSchemaDraft {
  const definition = schema._zod.def;
  const done = (result: ProtocolSchemaDraft) => annotate(schema.description, result);
  switch (typeOf(schema)) {
    case 'any':
    case 'unknown':
      return done({ kind: 'any' });
    case 'never':
    case 'void':
    case 'undefined':
      return done({ kind: 'void' });
    case 'null':
      return done({ kind: 'null' });
    case 'boolean':
      return done({ kind: 'boolean' });
    case 'string':
      return done(applyLengthChecks(
        schema, { kind: 'string' }, { min: 'minLength', max: 'maxLength' }, 'string', path,
      ));
    case 'number':
      return done(convertNumber(schema, path));
    case 'literal':
      return done(literal(definition.values, path));
    case 'enum':
      return done({ kind: 'enum', values: nativeEnumValues(definition.entries) });
    case 'array':
      return done(applyLengthChecks(
        schema,
        { kind: 'array', items: convertZodV4Schema(definition.element, `${path}.items`) },
        { min: 'minItems', max: 'maxItems' },
        'array',
        path,
      ));
    case 'object': {
      const policy = unknownProperties(definition.catchall, path);
      const shape = definition.shape as Record<string, ZodV4Schema>;
      return done({
        kind: 'object',
        properties: Object.fromEntries(Object.entries(shape).map(([name, property]) => [
          name,
          convertZodV4Schema(property, `${path}.properties.${name}`),
        ])),
        required: Object.entries(shape)
          .filter(([, property]) => !isOptionalProperty(property))
          .map(([name]) => name),
        unknownProperties: policy,
      });
    }
    case 'record':
      if (!isUnconstrainedRecordKey(definition.keyType)) {
        throw new ProtocolSchemaAdapterError('Unsupported constrained Zod record key', path);
      }
      return done({ kind: 'record', values: convertZodV4Schema(definition.valueType, `${path}.values`) });
    case 'union':
      // A discriminated union is a union with a `discriminator`. RFC 0004 has
      // no discriminator index; each variant keeps its literal property.
      return done({
        kind: 'union',
        variants: (definition.options as ZodV4Schema[]).map((option, index) =>
          convertZodV4Schema(option, `${path}.variants[${index}]`)),
      });
    case 'nullable':
      return done({
        kind: 'union',
        variants: [convertZodV4Schema(definition.innerType, `${path}.variants[0]`), { kind: 'null' }],
      });
    case 'optional':
    case 'readonly':
      return done(convertZodV4Schema(definition.innerType, path));
    case 'default':
      return done(withDefault(convertZodV4Schema(definition.innerType, path), definition.defaultValue, path));
    case 'pipe':
      throw new ProtocolSchemaAdapterError(`Unsupported Zod effect "${pipeEffect(definition)}"`, path);
    default:
      throw new ProtocolSchemaAdapterError(`Unsupported Zod type "${typeOf(schema)}"`, path);
  }
}
