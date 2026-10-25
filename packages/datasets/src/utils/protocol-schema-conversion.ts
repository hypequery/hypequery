import { validateCanonicalValue, type CanonicalValue } from '@hypequery/protocol';

export class ProtocolSchemaAdapterError extends TypeError {
  readonly path: string;

  constructor(message: string, path = '$') {
    super(`${message} at ${path}`);
    this.name = 'ProtocolSchemaAdapterError';
    this.path = path;
  }
}

export type ProtocolSchemaDraft = Record<string, unknown>;

export function canonicalValue(input: unknown, path: string): CanonicalValue {
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

/** Values of a TypeScript enum object, without the reverse mappings of numeric members. */
export function nativeEnumValues(input: Record<string, string | number>): readonly (string | number)[] {
  const values = Object.keys(input)
    .filter(key => typeof input[String(input[key])] !== 'number')
    .map(key => input[key]);
  return [...new Set(values)];
}

export function annotate(description: unknown, result: ProtocolSchemaDraft): ProtocolSchemaDraft {
  return typeof description === 'string' ? { ...result, description } : result;
}

export function withDefault(
  inner: ProtocolSchemaDraft,
  value: unknown,
  path: string,
): ProtocolSchemaDraft {
  if (inner.kind === 'void') {
    throw new ProtocolSchemaAdapterError('Void schemas cannot carry defaults', path);
  }
  return { ...inner, default: canonicalValue(value, `${path}.default`) };
}
