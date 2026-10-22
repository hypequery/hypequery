import { describe, expect, it } from 'vitest';
import { dataset } from './dataset.js';
import { dimension } from './field.js';
import { measure } from './measure.js';
import { divide, nullIfZero } from './formulas.js';
import { merge } from './aggregations.js';
import { createDatasetClient } from './executor.js';
import { createInMemoryBackend } from './in-memory-backend.js';
import { getDatasetCatalog } from './catalog.js';
import { serializeSemanticContract } from './contract.js';
import { buildProtocolDeploymentContract } from './protocol-deployment-adapter.js';
import { createRenderingBuilderFactory } from './tests/support/sql-equality-harness.js';
import { AGGREGATE_STATE_FUNCTIONS } from './utils/aggregate-state-functions.js';
import type { MeasureDefinition } from './types.js';
import type { QueryBuilderFactoryLike } from './query-builder-protocol.js';

// hq_saas.daily_active_users: an AggregatingMergeTree fed by a materialized view.
//   users  AggregateFunction(uniq, Nullable(UUID))
//   events SimpleAggregateFunction(sum, UInt64)
const DailyActiveUsers = dataset('dailyActiveUsers', {
  source: 'hq_saas.daily_active_users',
  timeKey: 'day',
  dimensions: {
    day: dimension.timestamp(),
    tenantId: dimension.string({ column: 'tenant_id' }),
  },
  measures: {
    activeUsers: measure.merge('uniq', 'users'),
    exactUsers: measure.merge('uniqExact', 'users_exact'),
    // SimpleAggregateFunction columns read with the plain aggregate.
    events: measure.sum('events'),
    eventsPerUser: measure.derived({
      uses: { events: 'events', users: 'exactUsers' },
      formula: ({ events, users }) => divide(events, nullIfZero(users)),
    }),
    weeklyActiveUsers: measure.trailing('activeUsers', { amount: 7, unit: 'day' }),
  },
});

const client = createDatasetClient({ queryBuilder: createRenderingBuilderFactory() });

describe('merge measures', () => {
  it('renders the -Merge combinator on the query-builder path', () => {
    expect(client.toSQL(DailyActiveUsers, { measures: ['activeUsers', 'events'], dimensions: ['tenantId'] }))
      .toMatch(/uniqMerge\(users\) AS `activeUsers`.*SUM\(events\) AS `events`/);
  });

  it('feeds derived measures', () => {
    const sql = client.toSQL(DailyActiveUsers, { measures: ['eventsPerUser'] });
    expect(sql).toContain('uniqExactMerge(users_exact)');
  });

  it('merges states across a trailing window, which is what makes weekly uniques correct', () => {
    const sql = client.toSQL(DailyActiveUsers, {
      measures: ['weeklyActiveUsers'],
      by: 'day',
      filters: [{ field: 'day', operator: 'between', value: ['2026-01-01', '2026-01-31'] }],
    });
    expect(sql).toContain('uniqMerge(');
    expect(sql).not.toContain('uniqMergeOrNull');
    // A count-like merge reads 0, not NULL, over an empty bucket.
    expect(sql).toContain('coalesce(');
  });

  it('refuses a builder without mergeState with a clear error', () => {
    const base = createRenderingBuilderFactory();
    const withoutMerge: QueryBuilderFactoryLike = {
      ...base,
      table: (name: string) => ({ ...base.table(name), mergeState: undefined }),
    };
    expect(() => createDatasetClient({ queryBuilder: withoutMerge }).toSQL(DailyActiveUsers, { measures: ['activeUsers'] }))
      .toThrow('Query builder does not support merge aggregations (mergeState).');
  });

  it('is exported as an aggregation helper for metric configs', () => {
    expect(merge('uniq', 'users')).toMatchObject({ aggregation: 'merge', field: 'users', stateFunction: 'uniq' });
  });
});

describe('merge measure validation', () => {
  it('rejects state functions outside the allowlist', () => {
    for (const name of ['quantile', 'uniqMerge', 'sum) FROM x --', 'groupArray']) {
      expect(() => measure.merge(name as never, 'users')).toThrow(/unsupported aggregate state/);
      expect(() => merge(name as never, 'users')).toThrow(/unsupported aggregate state/);
    }
    expect(AGGREGATE_STATE_FUNCTIONS).toContain('uniq');
  });

  it('rejects hand-built or rehydrated definitions with a bad state function, filters or sql', () => {
    const build = (definition: Partial<MeasureDefinition>) => () => dataset('bad', {
      source: 'bad',
      dimensions: { kind: dimension.string() },
      measures: { m: { __type: 'measure_definition', aggregation: 'merge', field: 'users', ...definition } as MeasureDefinition },
    });
    expect(build({ stateFunction: 'nope' as never })).toThrow(/merges unsupported aggregate state "nope"/);
    expect(build({ stateFunction: undefined })).toThrow(/merges unsupported aggregate state "undefined"/);
    expect(build({ stateFunction: 'uniq', filters: [{ field: 'kind', operator: 'eq', value: 'x' }] }))
      .toThrow(/cannot have filters/);
    expect(build({ stateFunction: 'uniq', sql: 'users' })).toThrow(/cannot use sql/);
  });

  it('refuses cumulative windows over a merge measure', () => {
    expect(() => dataset('cumulative', {
      source: 'dau', timeKey: 'day',
      dimensions: { day: dimension.timestamp() },
      measures: { users: measure.merge('uniq', 'users'), running: measure.cumulative('users') },
    })).toThrow(/cannot accumulate merge/);
  });

  it('refuses merge measures through relationships', () => {
    const Tenants = dataset('tenants', {
      source: 'tenants',
      dimensions: { id: dimension.string(), plan: dimension.string() },
      relationships: {
        activity: { __type: 'relationship', kind: 'hasOne', target: () => DailyActiveUsers, from: 'id', to: 'tenant_id' },
      },
    });
    expect(() => client.toSQL(Tenants, { measures: ['activity.activeUsers'] }))
      .toThrow(/cannot merge aggregate states through a relationship/);
  });

  it('refuses semantic backends such as the in-memory backend', async () => {
    const memory = createDatasetClient({ backend: createInMemoryBackend({ 'hq_saas.daily_active_users': [{ users: 'state' }] }) });
    await expect(async () => memory.execute(DailyActiveUsers, { measures: ['activeUsers'] }))
      .rejects.toThrow(/Semantic backend plans do not support merge measure "activeUsers"/);
  });
});

describe('merge measure catalogs and publishing', () => {
  it('records the state function and marks estimating states approximate', () => {
    const catalog = getDatasetCatalog(DailyActiveUsers);
    expect(catalog.measures.activeUsers).toMatchObject({ aggregation: 'merge', stateFunction: 'uniq', approximate: true });
    expect(catalog.measures.exactUsers).toMatchObject({ aggregation: 'merge', stateFunction: 'uniqExact' });
    expect('approximate' in catalog.measures.exactUsers!).toBe(false);
    expect('stateFunction' in catalog.measures.events!).toBe(false);

    const contract = serializeSemanticContract({ dailyActiveUsers: DailyActiveUsers });
    expect(contract.datasets.dailyActiveUsers!.measures.activeUsers).toMatchObject({ stateFunction: 'uniq', approximate: true });
  });

  it('refuses publishing to the deployment contract', () => {
    const Local = dataset('dau', {
      source: 'dau',
      dimensions: { day: dimension.timestamp() },
      measures: { users: measure.merge('uniqExact', 'users') },
    });
    expect(() => buildProtocolDeploymentContract([Local]))
      .toThrow(/Measure "dau\.users" uses merge, which cannot be published/);
  });
});
