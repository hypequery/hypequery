/** A JSON Schema document, as the canonical compiler emits it. */
type Schema = Record<string, unknown>;

/** Where a draft-07 document keeps the subschemas its `$ref`s point at. */
const DEFINITIONS = 'definitions';
const POINTER = `#/${DEFINITIONS}/`;

export interface HoistedSchema {
  /** The document without its definitions, every reference renamed. */
  readonly schema: Schema;
  /** Its definitions under the new names. */
  readonly definitions: Schema;
}

/**
 * Detach a document's definitions under names that start with `prefix`, so it
 * can join others in one document without two `__schema0`s colliding. A
 * `$ref` resolves from the document root, so definitions left inside an
 * `anyOf` member would no longer be found; the caller places them at the root.
 */
export function hoistDefinitions(schema: Schema, prefix: string): HoistedSchema {
  const { [DEFINITIONS]: found, ...rest } = schema;
  if (!isPlainObject(found)) return { schema, definitions: {} };
  const rename = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rename);
    if (!isPlainObject(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
      key,
      key === '$ref' && typeof child === 'string' && child.startsWith(POINTER)
        ? `${POINTER}${prefix}${child.slice(POINTER.length)}`
        : rename(child),
    ]));
  };
  return {
    schema: rename(rest) as Schema,
    definitions: Object.fromEntries(Object.entries(found).map(([name, definition]) => [
      `${prefix}${name}`,
      rename(definition),
    ])),
  };
}

function isPlainObject(value: unknown): value is Schema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
