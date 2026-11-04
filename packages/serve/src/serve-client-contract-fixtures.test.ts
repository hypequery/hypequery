import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dataset, dimension, divide, measure, type DimensionDefinition, type MeasureDefinition } from '@hypequery/datasets';
import { createAPI } from './server/create-api.js';
import { AuthError, createBearerTokenStrategy } from './auth.js';
import { semanticFixtureBuilder } from './semantic/datasets/utils/semantic-fixture-builder.js';

interface FixtureCase {
  id: string;
  path: string;
  credential: 'valid' | 'none';
  /** `current` pins the exported schemaHash of the endpoint at `path`. */
  pin?: 'current' | string;
  json?: unknown;
  expect: {
    status: number;
    data?: unknown[];
    meta?: false | { rowCount: number; pagination: { limit: number; offset: number; hasMore: boolean } };
    error?: { type: string; message: string; details?: unknown };
  };
}

interface FixtureDimension { type: 'string' | 'number' | 'boolean' | 'timestamp'; column?: string; label?: string; groupable?: boolean }
type FixtureMeasure =
  | { aggregation: 'sum' | 'count' | 'max'; field: string; description?: string }
  | { divide: [string, string] };

const fixtures = JSON.parse(readFileSync(new URL(
  '../../../specs/serve-http/fixtures/client-contract-v1/cases.json', import.meta.url,
), 'utf8')) as {
  app: {
    credential: string; basePath: string; mountPath: string;
    dataset: {
      name: string; source: string; description: string; timeKey: string; timeGrains: ('day' | 'month')[];
      dimensions: Record<string, FixtureDimension>;
      measures: Record<string, FixtureMeasure>;
      filters: Record<string, { field: string; operators?: ('eq' | 'in' | 'like' | 'gte')[] }>;
      limits: { maxResultSize: number; maxMeasures: number };
    };
    metric: { name: string; measure: string };
    rows: Array<Record<string, unknown>>;
  };
  contract: { canonical: string; contentHash: string } | null;
  cases: FixtureCase[];
};

/** The fixture dataset, authored as Python's test authors it. */
function fixtureApi() {
  const config = fixtures.app;
  const source = config.dataset;
  const dimensions = Object.fromEntries(Object.entries(source.dimensions).map(([name, field]): [string, DimensionDefinition] => {
    const options = { column: field.column, label: field.label, groupable: field.groupable };
    return [name, dimension[field.type](options)];
  }));
  const measures = Object.fromEntries(Object.entries(source.measures).map(([name, definition]) => {
    if ('divide' in definition) {
      const [numerator, denominator] = definition.divide;
      return [name, measure.derived({
        uses: { numerator, denominator },
        formula: ({ numerator, denominator }) => divide(numerator, denominator),
      })];
    }
    return [name, measure[definition.aggregation](definition.field, { description: definition.description }) as MeasureDefinition];
  }));
  const orders = dataset(source.name, {
    source: source.source,
    description: source.description,
    timeKey: source.timeKey,
    timeGrains: source.timeGrains,
    dimensions,
    measures,
    filters: Object.fromEntries(Object.entries(source.filters).map(([name, filter]) => [name, {
      __type: 'filter_definition' as const, field: filter.field, operators: filter.operators,
    }])),
    limits: source.limits,
  });
  return createAPI({
    basePath: config.basePath,
    clientContract: { mountPath: config.mountPath },
    auth: createBearerTokenStrategy({ validate: token => {
      if (token !== config.credential) throw new AuthError('INVALID', 'Invalid token');
      return { userId: 'alice' };
    } }),
    datasets: { [source.name]: orders },
    metrics: { [config.metric.name]: orders.metric(config.metric.name, { measure: config.metric.measure }) },
    queryBuilder: semanticFixtureBuilder(config.rows),
  });
}

function schemaHash(path: string): string {
  const contract = JSON.parse(fixtures.contract!.canonical) as { endpoints: { path: string; schemaHash: string }[] };
  return contract.endpoints.find(endpoint => endpoint.path === fixtures.app.mountPath + path)!.schemaHash;
}

describe('shared client contract fixtures (client-contract-v1)', () => {
  it('exports the contract Python exports for the same definition', () => {
    const exported = fixtureApi().clientContract();
    expect(exported.canonical).toBe(fixtures.contract!.canonical);
    expect(exported.contentHash).toBe(fixtures.contract!.contentHash);
  });

  it.each(fixtures.cases)('$id', async fixture => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (fixture.credential === 'valid') headers.authorization = `Bearer ${fixtures.app.credential}`;
    if (fixture.pin !== undefined) {
      headers['x-hypequery-client-schema'] = fixture.pin === 'current' ? schemaHash(fixture.path) : fixture.pin;
    }
    const response = await fixtureApi().handler({ method: 'POST', path: fixture.path, headers, query: {}, body: fixture.json });
    const body = JSON.parse(JSON.stringify(response.body));
    const expected = fixture.expect;
    expect(response.status, JSON.stringify(body)).toBe(expected.status);
    if (expected.data !== undefined) expect(body.data).toEqual(expected.data);
    if (expected.meta === false) expect(body).not.toHaveProperty('meta');
    else if (expected.meta !== undefined) {
      // The closed public metadata an RFC 0018 client validates.
      expect(Object.keys(body.meta).every(key => ['requestId', 'timingMs', 'rowCount', 'pagination', 'cache'].includes(key))).toBe(true);
      expect(body.meta).toMatchObject(expected.meta);
      expect(body.meta.requestId).toEqual(expect.any(String));
    }
    if (expected.error !== undefined) expect(body.error).toMatchObject(expected.error);
  });
});
