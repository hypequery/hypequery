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
 *
 * Checked on the model-ready form, so constraint-only combinators beside the
 * requirement (the local server's "select a dimension or measure") are already
 * gone and cannot hide it.
 */
export function acceptsNoInput(schema: JsonSchemaObject): boolean {
  const model = toModelInputSchema(schema);
  const properties = propertiesOf(model);
  return requiredOf(model).some(name => same(properties[name], { not: {} }));
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
    // Each distinct schema this property takes, with the targets that offer it.
    const options = new Map<string, { schema: unknown; targets: Target[]; count: number }>();
    for (const variant of variants) {
      const property = propertiesOf(variant)[name];
      if (property === undefined) continue;
      const key = canonical(property);
      const option = options.get(key) ?? { schema: property, targets: [], count: 0 };
      const target = targetOf(variant);
      if (target !== undefined && !option.targets.some(other => other.name === target.name)) option.targets.push(target);
      option.count += 1;
      options.set(key, option);
    }
    const offered = [...options.values()];
    // A property that is the same for every variant needs no label, nor do the
    // properties that pick the variant.
    const label = !TARGET_KEYS.has(name) && (offered.length > 1 || offered[0].count < variants.length);
    const schemas = offered.map(option => (label ? labelled(option.schema, option.targets) : option.schema));
    properties[name] = schemas.length === 1 ? schemas[0] : { anyOf: schemas };
  }
  const required = variants
    .map(variant => new Set(requiredOf(variant)))
    .reduce((shared, next) => new Set([...shared].filter(name => next.has(name))));
  const accepted: Schema = { type: 'object', properties, ...definitionsOf(variants) };
  if (required.size > 0) accepted.required = [...required];
  if (variants.every(variant => variant.additionalProperties === false)) accepted.additionalProperties = false;
  return accepted;
}

/** The properties whose `const` picks a variant: `dataset`, and `metric` for `query_metric`. */
const TARGET_KEYS = new Set(['dataset', 'metric']);

interface Target { readonly kind: 'dataset' | 'metric'; readonly name: string }

/** What a variant is for: its metric on its dataset, or its dataset. */
function targetOf(variant: Schema): Target | undefined {
  const dataset = constOf(propertiesOf(variant).dataset);
  const metric = constOf(propertiesOf(variant).metric);
  if (metric !== undefined) {
    return { kind: 'metric', name: dataset === undefined ? quote(metric) : `${quote(metric)} on ${quote(dataset)}` };
  }
  return dataset === undefined ? undefined : { kind: 'dataset', name: quote(dataset) };
}

function constOf(schema: unknown): string | undefined {
  return isPlainObject(schema) && typeof schema.const === 'string' ? schema.const : undefined;
}

/**
 * Says which datasets (or metrics) an option is for, which the flat schema can
 * no longer enforce. The server still does; the label lets the model get it
 * right first.
 */
function labelled(schema: unknown, targets: Target[]): unknown {
  if (!isPlainObject(schema) || targets.length === 0) return schema;
  const kind = targets[0].kind;
  const names = targets.map(target => target.name).join(', ');
  const which = `${targets.length === 1 ? kind : `${kind}s`} ${names}`;
  const label = schema.maxItems === 0 ? `None for ${which}.` : `For ${which} only.`;
  const description = typeof schema.description === 'string' ? `${label} ${schema.description}` : label;
  return { ...schema, description };
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

function same(left: unknown, right: unknown): boolean {
  return canonical(left) === canonical(right);
}

/** JSON with object keys sorted, so equal schemas compare equal in either language. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => (isPlainObject(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]))
    : item));
}

function quote(name: string): string {
  return JSON.stringify(name);
}

function isPlainObject(value: unknown): value is Schema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
