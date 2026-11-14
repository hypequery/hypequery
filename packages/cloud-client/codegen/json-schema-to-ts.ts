/**
 * Turns the JSON Schema subset Cloud's operation spec uses (draft 2020-12, as
 * written by `z.toJSONSchema`) into a TypeScript type expression.
 *
 * Validation keywords (`pattern`, `minLength`, `maximum`, ...) have no type
 * equivalent and are left to the server; `description`, `default` and
 * `format` become JSDoc. An unknown keyword never fails generation: the worst
 * case is a wider type.
 */

export type JsonSchema = {
  readonly type?: string | readonly string[];
  readonly const?: unknown;
  readonly enum?: readonly unknown[];
  readonly anyOf?: readonly JsonSchema[];
  readonly oneOf?: readonly JsonSchema[];
  readonly allOf?: readonly JsonSchema[];
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean | JsonSchema;
  readonly items?: JsonSchema;
  readonly description?: string;
  readonly default?: unknown;
  readonly format?: string;
  readonly [keyword: string]: unknown;
};

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export function propertyKey(name: string): string {
  return IDENTIFIER.test(name) ? name : JSON.stringify(name);
}

export function literal(value: unknown): string {
  return JSON.stringify(value);
}

/** JSDoc for a property or declaration, or '' when the schema says nothing. */
export function jsDoc(schema: JsonSchema, indent: string, extra: readonly string[] = []): string {
  const lines: string[] = [];
  if (typeof schema.description === 'string') lines.push(...schema.description.split('\n'));
  if (typeof schema.format === 'string') lines.push(`@format ${schema.format}`);
  if (schema.default !== undefined) lines.push(`@default ${literal(schema.default)}`);
  lines.push(...extra);
  if (lines.length === 0) return '';
  const safe = lines.map((line) => line.replaceAll('*/', '*\\/'));
  if (safe.length === 1) return `${indent}/** ${safe[0]} */\n`;
  return `${indent}/**\n${safe.map((line) => `${indent} * ${line}`.trimEnd()).join('\n')}\n${indent} */\n`;
}

function union(members: readonly string[]): string {
  const unique = [...new Set(members)];
  if (unique.length === 0) return 'never';
  return unique.join(' | ');
}

function parenthesize(type: string): string {
  return /[|&]/.test(type) ? `(${type})` : type;
}

function emitObject(schema: JsonSchema, indent: string): string {
  const properties = Object.entries(schema.properties ?? {});
  const extra = schema.additionalProperties;
  const extraType =
    extra === undefined || extra === false
      ? undefined
      : extra === true
        ? 'unknown'
        : emitType(extra, indent);

  if (properties.length === 0) {
    if (extraType !== undefined) return `Record<string, ${extraType}>`;
    return 'Record<string, never>';
  }

  const required = new Set(schema.required ?? []);
  const inner = `${indent}  `;
  const lines = properties.map(([name, property]) => {
    const optional = required.has(name) ? '' : '?';
    return `${jsDoc(property, inner)}${inner}${propertyKey(name)}${optional}: ${emitType(property, inner)};`;
  });
  if (extraType !== undefined) lines.push(`${inner}[key: string]: unknown;`);
  return `{\n${lines.join('\n')}\n${indent}}`;
}

function emitForType(type: string, schema: JsonSchema, indent: string): string {
  switch (type) {
    case 'string':
      return 'string';
    case 'integer':
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'null':
      return 'null';
    case 'array':
      return schema.items ? `Array<${emitType(schema.items, indent)}>` : 'unknown[]';
    case 'object':
      return emitObject(schema, indent);
    default:
      return 'unknown';
  }
}

/** The TypeScript type for `schema`; nested objects are indented under `indent`. */
export function emitType(schema: JsonSchema, indent = ''): string {
  if (schema.const !== undefined) return literal(schema.const);
  if (Array.isArray(schema.enum)) return union(schema.enum.map(literal));
  const variants = schema.anyOf ?? schema.oneOf;
  if (variants) return union(variants.map((variant) => emitType(variant, indent)));
  if (schema.allOf) {
    return schema.allOf.map((part) => parenthesize(emitType(part, indent))).join(' & ');
  }
  if (Array.isArray(schema.type)) {
    return union(schema.type.map((type) => emitForType(type, schema, indent)));
  }
  if (typeof schema.type === 'string') return emitForType(schema.type, schema, indent);
  if (schema.properties) return emitObject(schema, indent);
  return 'unknown';
}
