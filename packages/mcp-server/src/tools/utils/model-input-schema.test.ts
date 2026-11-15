import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import type { JsonSchemaObject } from './model-input-schema.js';
import { acceptsNoInput, toModelInputSchema } from './model-input-schema.js';

// The canonical query_dataset schemas both languages build, pinned cross-language.
const fixtures = JSON.parse(
  readFileSync(new URL('../../../../../specs/mcp/tool-schemas-v1.json', import.meta.url), 'utf8'),
) as Record<string, { query_dataset: JsonSchemaObject; query_metric?: JsonSchemaObject }>;

const COMBINATORS = ['anyOf', 'oneOf', 'allOf'];

describe('toModelInputSchema', () => {
  for (const [name, fixture] of Object.entries(fixtures)) {
    it(`gives a provider-ready object schema for the "${name}" fixture`, () => {
      for (const schema of [fixture.query_dataset, fixture.query_metric].filter(Boolean) as JsonSchemaObject[]) {
        const model = toModelInputSchema(schema);
        expect(model.type).toBe('object');
        expect(COMBINATORS.filter(key => key in model)).toEqual([]);
      }
    });
  }

  it('offers every dataset and each dataset’s fields', () => {
    const model = toModelInputSchema(fixtures.build!.query_dataset);
    const variants = fixtures.build!.query_dataset.anyOf as JsonSchemaObject[];
    const datasets = variants.map(variant => (variant.properties as Record<string, unknown>).dataset);
    const offered = (model.properties as Record<string, { anyOf?: unknown[] }>).dataset;
    expect(offered?.anyOf ?? [offered]).toEqual(expect.arrayContaining(datasets));
    // Only what every variant requires stays required.
    expect(model.required).toContain('dataset');
    expect(model.additionalProperties).toBe(false);
  });

  it('leaves a schema without top-level combinators untouched', () => {
    const plain: JsonSchemaObject = { type: 'object', properties: { a: { type: 'string' } } };
    expect(toModelInputSchema(plain)).toEqual(plain);
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

describe('toModelInputSchema in draft 2020-12 terms', () => {
  it('gives valid draft 2020-12 for every fixture', () => {
    const ajv = new Ajv2020({ strict: false });
    for (const fixture of Object.values(fixtures)) {
      for (const schema of [fixture.query_dataset, fixture.query_metric].filter(Boolean) as JsonSchemaObject[]) {
        expect(ajv.validateSchema(toModelInputSchema(schema)), JSON.stringify(ajv.errors)).toBe(true);
      }
    }
  });

  it('rewrites a draft-07 tuple and leaves data keywords alone', () => {
    const between = { type: 'array', items: [{ type: 'string' }, { type: 'string' }] };
    const model = toModelInputSchema({
      type: 'object',
      properties: { value: { ...between, additionalItems: false }, range: between },
      enumLike: { enum: [{ items: [1, 2] }] },
    });
    expect(model.properties).toEqual({
      value: { type: 'array', prefixItems: [{ type: 'string' }, { type: 'string' }], items: false },
      range: { type: 'array', prefixItems: [{ type: 'string' }, { type: 'string' }] },
    });
    expect(model.enumLike).toEqual({ enum: [{ items: [1, 2] }] });
  });
});

describe('acceptsNoInput', () => {
  it('holds for the tools a contract offers nothing under', () => {
    expect(acceptsNoInput(fixtures.empty!.query_dataset)).toBe(true);
    expect(acceptsNoInput(fixtures.empty!.query_metric!)).toBe(true);
    expect(acceptsNoInput(fixtures['metric-only']!.query_dataset)).toBe(true);
    expect(acceptsNoInput(fixtures['metric-only']!.query_metric!)).toBe(false);
    expect(acceptsNoInput(fixtures.build!.query_dataset)).toBe(false);
  });

  it('needs the unsatisfiable property to be required', () => {
    expect(acceptsNoInput({ type: 'object', properties: { dataset: { not: {} } } })).toBe(false);
    expect(acceptsNoInput({ type: 'object', properties: { a: { not: { type: 'string' } } }, required: ['a'] })).toBe(false);
    expect(acceptsNoInput({ type: 'object', properties: { a: { not: {} } }, required: ['a'] })).toBe(true);
  });
});

describe('labels on flattened options', () => {
  it('says which dataset each option is for, and when a dataset has none', () => {
    const model = toModelInputSchema({
      anyOf: [
        { type: 'object', properties: { dataset: { const: 'countries' }, dimensions: { items: { enum: ['country'] } }, measures: { maxItems: 0, items: { not: {} } }, limit: { type: 'integer' } } },
        { type: 'object', properties: { dataset: { const: 'orders' }, dimensions: { items: { enum: ['country', 'customer.tier'] }, description: 'Group by these.' }, measures: { items: { enum: ['revenue'] } }, limit: { type: 'integer' }, having: { type: 'array' } } },
      ],
    });
    const properties = model.properties as Record<string, any>;
    expect(properties.dimensions.anyOf.map((option: any) => option.description)).toEqual([
      'For dataset "countries" only.',
      'For dataset "orders" only. Group by these.',
    ]);
    expect(properties.measures.anyOf[0].description).toBe('None for dataset "countries".');
    // Offered by only one dataset, so labelled even as the single option.
    expect(properties.having.description).toBe('For dataset "orders" only.');
    // The same for every dataset: no label. The dataset choice itself is never labelled.
    expect(properties.limit).toEqual({ type: 'integer' });
    expect(properties.dataset.anyOf).toEqual([{ const: 'countries' }, { const: 'orders' }]);
  });

  it('names every dataset that shares an option', () => {
    const shared = { items: { enum: ['country'] } };
    const model = toModelInputSchema({
      anyOf: ['a', 'b', 'c'].map(name => ({
        type: 'object',
        properties: { dataset: { const: name }, dimensions: name === 'c' ? { items: { enum: ['x'] } } : shared },
      })),
    });
    expect((model.properties as any).dimensions.anyOf[0].description).toBe('For datasets "a", "b" only.');
  });
  it('labels query_metric options by metric, once each', () => {
    const variant = (dataset: string, metric: string, orderBy: string[]) => ({
      type: 'object',
      properties: { dataset: { const: dataset }, metric: { const: metric }, dimensions: { items: { enum: ['region'] } }, orderBy: { items: { enum: orderBy } } },
    });
    const model = toModelInputSchema({ anyOf: [variant('orders', 'a', ['a', 'region']), variant('orders', 'b', ['b', 'region']), variant('events', 'c', ['c'])] });
    const properties = model.properties as Record<string, any>;
    expect(properties.orderBy.anyOf.map((option: any) => option.description)).toEqual([
      'For metric "a" on "orders" only.',
      'For metric "b" on "orders" only.',
      'For metric "c" on "events" only.',
    ]);
    // The same for every variant: no label. Neither picker property is labelled.
    expect(properties.dimensions).toEqual({ items: { enum: ['region'] } });
    expect(properties.metric.anyOf).toEqual([{ const: 'a' }, { const: 'b' }, { const: 'c' }]);
  });

  it('treats schemas that differ only in key order as the same option', () => {
    const model = toModelInputSchema({
      anyOf: [
        { type: 'object', properties: { dataset: { const: 'a' }, limit: { type: 'integer', maximum: 5 } } },
        { type: 'object', properties: { dataset: { const: 'b' }, limit: { maximum: 5, type: 'integer' } } },
      ],
    });
    expect((model.properties as any).limit).toEqual({ type: 'integer', maximum: 5 });
  });
});
