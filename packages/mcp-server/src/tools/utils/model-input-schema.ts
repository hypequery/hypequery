/** A JSON Schema object, as `tools/list` carries it. */
export type JsonSchemaObject = Record<string, unknown>;

type Schema = JsonSchemaObject;

const COMBINATORS = ['anyOf', 'oneOf', 'allOf'] as const;

/** Where a schema keeps the subschemas its `$ref`s point at; carried through so no reference breaks. */
const DEFINITIONS = ['$defs', 'definitions'] as const;

/**
 * A tool's input schema as model providers accept it: valid JSON Schema draft
 * 2020-12, and one object schema with no `anyOf`, `oneOf` or `allOf` at the top.
 * Anthropic rejects either problem outright, and `query_dataset` has one
 * variant per dataset.
 *
 * The variants merge into one object: a property in several variants offers each
 * of their schemas. Constraints that need a top-level combinator, such as "this
 * dataset's fields only" or "at least one dimension or measure", are dropped
 * here; the server validates every call against the exact schema and returns a
 * correctable error, so the model learns them from the result instead.
 */
export function toModelInputSchema(schema: JsonSchemaObject): JsonSchemaObject {
  const current = toDraft202012(schema) as JsonSchemaObject;
  return COMBINATORS.some(key => key in current) ? flatten(current) : current;
}

/** Keywords whose values are data, not subschemas; left exactly as they are. */
const DATA_KEYWORDS = new Set(['const', 'enum', 'default', 'examples']);

/**
 * Rewrites draft-07 tuples, which the exact schemas use for `between` values, in
 * draft 2020-12 terms: `items: [a, b]` becomes `prefixItems: [a, b]`, and
 * `additionalItems: false` becomes `items: false`. Model APIs (and MCP) read
 * 2020-12, where an array under `items` is invalid and the request fails.
 */
function toDraft202012(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toDraft202012);
  if (!isPlainObject(value)) return value;
  const result: Schema = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = DATA_KEYWORDS.has(key) ? child : toDraft202012(child);
  }
  if (Array.isArray(result.items)) {
    result.prefixItems = result.items;
    delete result.items;
    if ('additionalItems' in result) {
      result.items = result.additionalItems;
      delete result.additionalItems;
    }
  }
  return result;
}

/**
 * Whether no input can satisfy `schema`: it requires a property whose schema is
 * `{ not: {} }`. A query tool compiles to that when nothing is offered under it
 * (no queryable dataset, no metric); such a tool is left out of `tools/list`.
 */
export function acceptsNoInput(schema: JsonSchemaObject): boolean {
  if (COMBINATORS.some(key => key in schema)) return false;
  const properties = propertiesOf(schema);
  return requiredOf(schema).some(name => same(properties[name], { not: {} }));
}

function flatten(schema: Schema): Schema {
  const { anyOf, oneOf, allOf, ...base } = schema;
  let result: Schema = { ...base, type: 'object' };
  // Every allOf member holds, so object members merge in. Members that are only
  // constraints (a combinator with no properties of its own) are left to the server.
  for (const member of schemasIn(allOf)) {
    if (isPlainObject(member.properties)) result = intersect(result, flatten(member));
  }
  // anyOf and oneOf both hold when both are present, so each narrows the result.
  for (const alternatives of [schemasIn(anyOf), schemasIn(oneOf)]) {
    if (alternatives.length > 0) result = intersect(result, union(alternatives.map(flatten)));
  }
  return result;
}

/** One object accepting what any variant accepts. */
function union(variants: Schema[]): Schema {
  const properties: Schema = {};
  const names = new Set(variants.flatMap(variant => Object.keys(propertiesOf(variant))));
  for (const name of names) {
    const options = distinct(variants.flatMap(variant => {
      const property = propertiesOf(variant)[name];
      return property === undefined ? [] : [property];
    }));
    properties[name] = options.length === 1 ? options[0] : { anyOf: options };
  }
  const required = variants
    .map(variant => new Set(requiredOf(variant)))
    .reduce((shared, next) => new Set([...shared].filter(name => next.has(name))));
  const accepted: Schema = { type: 'object', properties, ...definitionsOf(variants) };
  if (required.size > 0) accepted.required = [...required];
  if (variants.every(variant => variant.additionalProperties === false)) accepted.additionalProperties = false;
  return accepted;
}

/** One object holding both schemas' properties and requirements. */
function intersect(left: Schema, right: Schema): Schema {
  const properties: Schema = { ...propertiesOf(left) };
  for (const [name, property] of Object.entries(propertiesOf(right))) {
    const existing = properties[name];
    properties[name] = existing === undefined || same(existing, property) ? property : { allOf: [existing, property] };
  }
  const required = [...new Set([...requiredOf(left), ...requiredOf(right)])];
  const merged: Schema = { ...right, ...left, ...definitionsOf([left, right]), type: 'object' };
  if (Object.keys(properties).length > 0) merged.properties = properties;
  if (required.length > 0) merged.required = required;
  if (left.additionalProperties === false || right.additionalProperties === false) merged.additionalProperties = false;
  return merged;
}

function definitionsOf(schemas: Schema[]): Schema {
  const found: Schema = {};
  for (const key of DEFINITIONS) {
    const merged = Object.assign({}, ...schemas.map(schema => (isPlainObject(schema[key]) ? schema[key] : {})));
    if (Object.keys(merged).length > 0) found[key] = merged;
  }
  return found;
}

function schemasIn(value: unknown): Schema[] {
  return Array.isArray(value) ? value.filter(isPlainObject) : [];
}

function propertiesOf(schema: Schema): Schema {
  return isPlainObject(schema.properties) ? schema.properties : {};
}

function requiredOf(schema: Schema): string[] {
  return Array.isArray(schema.required) ? schema.required.filter((name): name is string => typeof name === 'string') : [];
}

function distinct(schemas: unknown[]): unknown[] {
  const seen = new Map<string, unknown>();
  for (const schema of schemas) seen.set(JSON.stringify(schema), schema);
  return [...seen.values()];
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isPlainObject(value: unknown): value is Schema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
