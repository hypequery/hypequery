import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { HypequeryJsonSchema } from '../types.js';
import { toModelInputSchema } from './model-input-schema.js';

// The canonical query_dataset schemas both languages build, pinned cross-language.
const fixtures = JSON.parse(
  readFileSync(new URL('../../../../../specs/mcp/tool-schemas-v1.json', import.meta.url), 'utf8'),
) as Record<string, { query_dataset: HypequeryJsonSchema; query_metric?: HypequeryJsonSchema }>;

const COMBINATORS = ['anyOf', 'oneOf', 'allOf'];

describe('toModelInputSchema', () => {
  for (const [name, fixture] of Object.entries(fixtures)) {
    it(`gives a provider-ready object schema for the "${name}" fixture`, () => {
      for (const schema of [fixture.query_dataset, fixture.query_metric].filter(Boolean) as HypequeryJsonSchema[]) {
        const model = toModelInputSchema(schema);
        expect(model.type).toBe('object');
        expect(COMBINATORS.filter(key => key in model)).toEqual([]);
      }
    });
  }

  it('offers every dataset and each dataset’s fields', () => {
    const model = toModelInputSchema(fixtures.build!.query_dataset);
    const variants = fixtures.build!.query_dataset.anyOf as HypequeryJsonSchema[];
    const datasets = variants.map(variant => (variant.properties as Record<string, unknown>).dataset);
    const offered = (model.properties as Record<string, { anyOf?: unknown[] }>).dataset;
    expect(offered?.anyOf ?? [offered]).toEqual(expect.arrayContaining(datasets));
    // Only what every variant requires stays required.
    expect(model.required).toContain('dataset');
    expect(model.additionalProperties).toBe(false);
  });

  it('leaves a schema without top-level combinators untouched', () => {
    const plain: HypequeryJsonSchema = { type: 'object', properties: { a: { type: 'string' } } };
    expect(toModelInputSchema(plain)).toBe(plain);
  });

  it('merges object members of allOf and drops constraint-only members', () => {
    const model = toModelInputSchema({
      type: 'object',
      properties: { dataset: { const: 'orders' } },
      required: ['dataset'],
      allOf: [
        { properties: { limit: { type: 'integer' } }, required: ['limit'] },
        { anyOf: [{ required: ['dimensions'] }, { required: ['measures'] }] },
        { properties: { dataset: { type: 'string' } } },
      ],
    });
    expect(model).toEqual({
      type: 'object',
      properties: {
        dataset: { allOf: [{ const: 'orders' }, { type: 'string' }] },
        limit: { type: 'integer' },
      },
      required: ['dataset', 'limit'],
    });
  });

  it('keeps what anyOf and oneOf both require when both are present', () => {
    const model = toModelInputSchema({
      type: 'object',
      anyOf: [
        { properties: { a: { type: 'string' } }, required: ['a'] },
        { properties: { a: { type: 'number' } }, required: ['a'] },
      ],
      oneOf: [{ properties: { b: { type: 'string' } }, required: ['b'] }],
    });
    expect(model).toEqual({
      type: 'object',
      properties: { a: { anyOf: [{ type: 'string' }, { type: 'number' }] }, b: { type: 'string' } },
      required: ['a', 'b'],
    });
  });

  it('keeps the definitions a variant’s $ref points at', () => {
    const model = toModelInputSchema({
      type: 'object',
      anyOf: [
        { properties: { filter: { $ref: '#/$defs/Filter' } }, $defs: { Filter: { type: 'object' } } },
        { properties: { limit: { type: 'integer' } } },
      ],
    });
    expect(model.$defs).toEqual({ Filter: { type: 'object' } });
    expect(model.properties?.filter).toEqual({ $ref: '#/$defs/Filter' });
  });
});
