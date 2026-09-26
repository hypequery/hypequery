import { describe, expect, it } from 'vitest';
import { dataset } from './dataset.js';
import { dimension } from './field.js';
import { measure } from './measure.js';
import { divide } from './formulas.js';
import { approxCountDistinct } from './aggregations.js';
import { createDatasetClient } from './executor.js';
import { createInMemoryBackend } from './in-memory-backend.js';
import { getDatasetCatalog } from './catalog.js';
import { serializeSemanticContract } from './contract.js';
import { projectAgentSafeCatalog } from './agent-catalog.js';
import { buildProtocolDeploymentContract } from './protocol-deployment-adapter.js';
import type { QueryBuilderFactoryLike, QueryBuilderLike } from './query-builder-protocol.js';

function sqlFactory(options: { approx?: boolean } = {}): QueryBuilderFactoryLike {
  function createBuilder(table: string): QueryBuilderLike {
    const select: string[] = [];
    const push = (part: string) => { select.push(part); return builder; };
    const builder = {
      select: (args: string | string[]) => { select.push(...(Array.isArray(args) ? args : [args])); return builder; },
      count: (c: string, a?: string) => push(`COUNT(${c}) AS ${a}`),
      ...(options.approx === false ? {} : {
        approxCountDistinct: (c: string, a?: string) => push(`uniq(${c}) AS ${a}`),
      }),
      where: () => builder,
      groupBy: () => builder,
      orderBy: () => builder,
      limit: () => builder,
      offset: () => builder,
      toSQLWithParams: () => ({ sql: `SELECT ${select.join(', ')} FROM ${table}`, parameters: [] }),
      execute: async () => [],
    } as unknown as QueryBuilderLike;
    return builder;
  }
  return { table: createBuilder, rawQuery: async () => [] };
}

const Events = dataset('events', {
  source: 'events',
  dimensions: {
    userId: dimension.string({ column: 'user_id' }),
    kind: dimension.string(),
  },
  measures: {
    visitors: measure.approxCountDistinct('user_id'),
    buyers: measure.approxCountDistinct('user_id', { filters: [{ field: 'kind', operator: 'eq', value: 'purchase' }] }),
    events: measure.count('id'),
    eventsPerVisitor: measure.derived({
      uses: { events: 'events', visitors: 'visitors' },
      formula: ({ events, visitors }) => divide(events, visitors),
    }),
    // Exact inputs only, so not approximate.
    eventsPerEvent: measure.derived({
      uses: { a: 'events', b: 'events' },
      formula: ({ a, b }) => divide(a, b),
    }),
  },
});

describe('approxCountDistinct', () => {
  it('renders uniq on the query-builder path, with the NULL fallback for filters', () => {
    const client = createDatasetClient({ queryBuilder: sqlFactory() });
    expect(client.toSQL(Events, { measures: ['visitors'] })).toBe('SELECT uniq(user_id) AS visitors FROM events');
    expect(client.toSQL(Events, { measures: ['buyers'] }))
      .toContain('uniq(if((kind = ');
  });

  it('refuses a builder without approxCountDistinct with a clear error', () => {
    const client = createDatasetClient({ queryBuilder: sqlFactory({ approx: false }) });
    expect(() => client.toSQL(Events, { measures: ['visitors'] }))
      .toThrow('Query builder does not support approxCountDistinct aggregations.');
  });

  it('computes an exact distinct count in the in-memory backend', async () => {
    const client = createDatasetClient({
      backend: createInMemoryBackend({
        events: [
          { id: 1, user_id: 'a', kind: 'view' },
          { id: 2, user_id: 'a', kind: 'purchase' },
          { id: 3, user_id: 'b', kind: 'view' },
        ],
      }),
    });
    const { data } = await client.execute(Events, { measures: ['visitors', 'events'] });
    expect(data).toEqual([{ visitors: '2', events: '3' }]);
  });

  it('skips NULL values like ClickHouse uniq and countDistinct', async () => {
    const NullableEvents = dataset('nullableEvents', {
      source: 'nullable_events',
      dimensions: { userId: dimension.string({ column: 'user_id' }) },
      measures: {
        estimated: measure.approxCountDistinct('user_id'),
        exact: measure.countDistinct('user_id'),
      },
    });
    const client = createDatasetClient({
      backend: createInMemoryBackend({
        nullable_events: [
          { user_id: 'a' }, { user_id: 'a' }, { user_id: 'b' },
          { user_id: null }, { user_id: null },
        ],
      }),
    });
    expect((await client.execute(NullableEvents, { measures: ['estimated', 'exact'] })).data)
      .toEqual([{ estimated: '2', exact: '2' }]);
  });

  it('is exported as an aggregation helper', () => {
    expect(approxCountDistinct('user_id')).toMatchObject({ aggregation: 'approxCountDistinct', field: 'user_id' });
  });
});

describe('approximate marker', () => {
  it('marks approximate base and derived measures, and only those', () => {
    const catalog = getDatasetCatalog(Events);
    expect(catalog.measures.visitors!.approximate).toBe(true);
    expect(catalog.measures.buyers!.approximate).toBe(true);
    expect('approximate' in catalog.measures.events!).toBe(false);
    expect(catalog.derivedMeasures!.eventsPerVisitor!.approximate).toBe(true);
    expect('approximate' in catalog.derivedMeasures!.eventsPerEvent!).toBe(false);
  });

  it('carries the marker into the semantic contract and the agent-safe catalog', () => {
    const contract = serializeSemanticContract({ events: Events });
    expect(contract.datasets.events!.measures.visitors).toMatchObject({ approximate: true });
    expect('approximate' in contract.datasets.events!.measures.events!).toBe(false);

    const agent = projectAgentSafeCatalog(contract);
    const measures = agent.datasets[0]!.measures;
    expect(measures.find(item => item.name === 'visitors')).toMatchObject({ approximate: true });
    expect(measures.find(item => item.name === 'events')).not.toHaveProperty('approximate');
  });
});

describe('publishing approxCountDistinct', () => {
  it('refuses the measure with an actionable error until contract 3 is emitted', () => {
    expect(() => buildProtocolDeploymentContract([Events]))
      .toThrow(/Measure "events\.visitors" uses approxCountDistinct, which cannot be published yet/);
  });
});
