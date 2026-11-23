import { dataset, dimension, measure } from '@hypequery/datasets';
import { describe, expect, it } from 'vitest';
import { buildMCPQuerySchemas } from './canonical-query-schemas.js';
import { hoistDefinitions } from './json-schema-definitions.js';
import { toModelInputSchema } from './model-input-schema.js';

describe('hoistDefinitions', () => {
  it('renames definitions and every reference to them', () => {
    const { schema, definitions } = hoistDefinitions({
      type: 'object',
      properties: { filters: { type: 'array', items: { $ref: '#/definitions/__schema0' } } },
      definitions: { __schema0: { anyOf: [{ type: 'string' }, { not: { $ref: '#/definitions/__schema0' } }] } },
    }, 'd1_');
    expect(schema).toEqual({ type: 'object', properties: { filters: { type: 'array', items: { $ref: '#/definitions/d1___schema0' } } } });
    expect(definitions).toEqual({ d1___schema0: { anyOf: [{ type: 'string' }, { not: { $ref: '#/definitions/d1___schema0' } }] } });
  });

  it('leaves a document without definitions untouched', () => {
    const schema = { type: 'object', properties: { ref: { $ref: 'https://example.test/x' } } };
    expect(hoistDefinitions(schema, 'x_')).toEqual({ schema, definitions: {} });
  });

  it('keeps references resolvable when exact and legacy entries share one registry', () => {
    const Orders = dataset('orders', {
      source: 'orders',
      dimensions: { status: dimension.string() },
      measures: { revenue: measure.sum('amount') },
    });
    const Events = dataset('events', {
      source: 'events',
      dimensions: { device: dimension.string() },
      measures: { events: measure.count() },
    });
    const schemas = buildMCPQuerySchemas({ events: Events, legacy: { dimensions: { kind: {} }, metrics: {} }, orders: Orders });
    const exact = schemas.queryDatasetJsonSchema as Record<string, any>;
    const names = Object.keys(exact.definitions);
    expect(names.length).toBeGreaterThanOrEqual(4);
    expect(new Set(names).size).toBe(names.length);
    const model = JSON.stringify(toModelInputSchema(exact));
    for (const [, ref] of model.matchAll(/"\$ref":"#\/definitions\/([^"]+)"/g)) expect(names).toContain(ref);
    expect(schemas.queryDataset.safeParse({
      dataset: 'orders', measures: ['revenue'], filters: [{ or: [{ field: 'status', operator: 'eq', value: 'paid' }] }],
    }).success).toBe(true);
  });
});
