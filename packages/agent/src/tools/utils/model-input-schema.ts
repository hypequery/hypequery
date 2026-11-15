import type { HypequeryJsonSchema } from '../types.js';

type Schema = Record<string, unknown>;

const COMBINATORS = ['anyOf', 'oneOf', 'allOf'] as const;

/**
 * A tool's input schema as model providers accept it: one object schema with no
 * `anyOf`, `oneOf` or `allOf` at the top. Anthropic rejects those outright, and
 * `query_dataset` has one variant per dataset.
 *
 * The variants merge into one object: a property in several variants offers each
 * of their schemas. Constraints that need a top-level combinator, such as "this
 * dataset's fields only" or "at least one dimension or measure", are dropped
 * here; the server validates every call against the exact schema and returns a
 * correctable error, so the model learns them from the result instead.
 */
export function toModelInputSchema(schema: HypequeryJsonSchema): HypequeryJsonSchema {
  return COMBINATORS.some(key => key in schema) ? (flatten(schema) as HypequeryJsonSchema) : schema;
}

function flatten(schema: Schema): Schema {
  const { anyOf, oneOf, allOf, ...base } = schema;
  let result: Schema = { ...base, type: 'object' };
  // Every allOf member holds, so object members merge in. Members that are only
  // constraints (a combinator with no properties of its own) are left to the server.
  for (const member of schemasIn(allOf)) {
    if (isPlainObject(member.properties)) result = intersect(result, flatten(member));
  }
  const variants = [...schemasIn(anyOf), ...schemasIn(oneOf)].map(flatten);
  return variants.length > 0 ? intersect(result, union(variants)) : result;
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
  const union: Schema = { type: 'object', properties };
  if (required.size > 0) union.required = [...required];
  if (variants.every(variant => variant.additionalProperties === false)) union.additionalProperties = false;
  return union;
}

/** One object holding both schemas' properties and requirements. */
function intersect(left: Schema, right: Schema): Schema {
  const properties: Schema = { ...propertiesOf(left) };
  for (const [name, property] of Object.entries(propertiesOf(right))) {
    const existing = properties[name];
    properties[name] = existing === undefined || same(existing, property) ? property : { allOf: [existing, property] };
  }
  const required = [...new Set([...requiredOf(left), ...requiredOf(right)])];
  const merged: Schema = { ...right, ...left, type: 'object' };
  if (Object.keys(properties).length > 0) merged.properties = properties;
  if (required.length > 0) merged.required = required;
  if (left.additionalProperties === false || right.additionalProperties === false) merged.additionalProperties = false;
  return merged;
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
