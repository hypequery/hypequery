import { z } from 'zod';
import { ExampleManifest, RecipeManifest } from './manifest.js';

const SCHEMA_BASE_URL = 'https://hypequery.com/schemas';

export const JSON_SCHEMA_FILES = {
  example: 'example.schema.json',
  recipe: 'recipe.schema.json',
} as const;

export type JsonSchemaKind = keyof typeof JSON_SCHEMA_FILES;

/** JSON Schema (draft 2020-12) for one manifest kind, as a plain object. */
export function toJsonSchema(kind: JsonSchemaKind): Record<string, unknown> {
  const schema = kind === 'example' ? ExampleManifest : RecipeManifest;
  const generated = z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' });
  return {
    $id: `${SCHEMA_BASE_URL}/${JSON_SCHEMA_FILES[kind]}`,
    title: kind === 'example' ? 'hypequery example manifest' : 'hypequery recipe manifest',
    ...generated,
  };
}

/** Stable, pretty-printed text so the committed file diffs cleanly. */
export function renderJsonSchema(kind: JsonSchemaKind): string {
  return `${JSON.stringify(toJsonSchema(kind), null, 2)}\n`;
}
