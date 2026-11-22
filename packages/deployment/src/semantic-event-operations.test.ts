/**
 * RFC 0027 funnels through the deployment data plane: the same enforcement
 * sequence as dataset queries, the contract-driven checks that only event
 * operations need, and the seam to the portable executor.
 */
import { createPortableSemanticRuntime } from '@hypequery/datasets';
import type { QueryBuilderFactoryLike, QueryBuilderLike } from '@hypequery/datasets';
import { describe, expect, it } from 'vitest';
import {
  createDeploymentSemanticDataPlane,
  DeploymentSemanticInvocationError,
  type DeploymentSemanticDataPlaneOptions,
  type DeploymentSemanticEventExecutionInput,
} from './semantic-data-plane.js';

const REVISION = 'b'.repeat(64);

function dimension(name: string, type: string, extra: Record<string, unknown> = {}) {
  return { name, type, source: { kind: 'column', column: name }, filterable: true, groupable: true, ...extra };
}

function contract(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'hypequery-deployment',
    version: 2,
    datasets: [{
      name: 'activity',
      source: 'analytics.activity',
      tenant: { kind: 'required', field: 'tenant_id' },
      timeField: 'occurredAt',
      events: { entity: 'userId', event: 'eventName' },
      dimensions: [
        dimension('userId', 'string'),
        dimension('accountId', 'number'),
        dimension('eventName', 'string'),
        dimension('plan', 'string'),
        dimension('region', 'string'),
        dimension('secret', 'string'),
        dimension('occurredAt', 'timestamp'),
      ],
      measures: [{ name: 'events', aggregation: 'count', field: 'userId', filters: [] }],
      filters: [],
      relationships: [],
      limits: { maxFilters: 8 },
      endpoint: {
        access: { kind: 'public' },
        tenant: { kind: 'required', mode: 'auto-inject', column: 'tenant_id' },
        maxLimit: 500,
      },
      ...overrides,
    }],
  };
}

const eq = (field: string, value: unknown) => ({
  kind: 'comparison', operator: 'eq', left: { kind: 'reference', name: field }, right: { kind: 'literal', value },
});
const between = (field: string, from: string, to: string) => ({
  kind: 'comparison', operator: 'between', left: { kind: 'reference', name: field },
  right: { kind: 'literal', value: { $hypequery: { type: 'tuple', version: 1, values: [from, to] } } },
});
const RANGE = between('occurredAt', '2026-10-01', '2026-11-01');

function funnel(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'funnel',
    dataset: 'activity',
    steps: [
      { name: 'signed_up', where: [eq('eventName', 'signup')] },
      { name: 'first_query', where: [eq('eventName', 'query_run')] },
    ],
    window: '7 day',
    filters: [RANGE],
    ...overrides,
  };
}

function invocation(operation: unknown, version = 1) {
  return { kind: 'hypequery-semantic-invocation', version, target: { project: 'acme', environment: 'production' }, operation };
}

const ROWS = [
  { step: 'signed_up', step_index: 1, entities: 10, conversion_from_previous: 1, conversion_from_first: 1, dropoff: 0 },
  { step: 'first_query', step_index: 2, entities: 4, conversion_from_previous: 0.4, conversion_from_first: 0.4, dropoff: 6 },
];

function plane(options: Partial<DeploymentSemanticDataPlaneOptions> = {}, deployment = contract()) {
  const calls: DeploymentSemanticEventExecutionInput[] = [];
  const datasetCalls: unknown[] = [];
  const instance = createDeploymentSemanticDataPlane({
    deployment: deployment as never,
    activationRevision: REVISION,
    resolveTenant: async () => 'acme',
    execute: async input => {
      datasetCalls.push(input);
      return { kind: 'hypequery-semantic-invocation-result', version: 1, activationRevision: REVISION, data: [], meta: { rowCount: 0 } };
    },
    executeEventOperation: async input => {
      calls.push(input);
      return { kind: 'hypequery-semantic-invocation-result', version: 1, activationRevision: REVISION, data: ROWS, meta: { rowCount: 2 } };
    },
    ...options,
  });
  return { instance, calls, datasetCalls };
}

async function failure(promise: Promise<unknown>): Promise<DeploymentSemanticInvocationError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DeploymentSemanticInvocationError) return error;
    throw error;
  }
  throw new Error('Expected the invocation to fail');
}

describe('funnel invocations (RFC 0027)', () => {
  it('runs through the event executor, never the dataset executor', async () => {
    const { instance, calls, datasetCalls } = plane();
    const result = await instance.invoke({ invocation: invocation(funnel()) });
    expect(result.data).toEqual(ROWS);
    expect(datasetCalls).toHaveLength(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.tenant).toBe('acme');
    expect(calls[0]!.operation.kind).toBe('funnel');
    expect(calls[0]!.budget.maxRows).toBe(500);
  });

  it('passes enforced constraints apart from the caller filters', async () => {
    const { instance, calls } = plane({ resolveConstraints: async () => [eq('region', 'eu')] });
    await instance.invoke({ invocation: invocation(funnel()) });
    expect(calls[0]!.operation.filters).toEqual([RANGE]);
    expect(calls[0]!.constraints).toEqual([eq('region', 'eu')]);
  });

  it('accepts a trusted time cutoff beside the caller range', async () => {
    const cutoff = { ...eq('occurredAt', '2026-10-15'), operator: 'gte' };
    const { instance, calls } = plane({ resolveConstraints: async () => [cutoff] });
    await instance.invoke({ invocation: invocation(funnel()) });
    expect(calls[0]!.operation.filters).toEqual([RANGE]);
    expect(calls[0]!.constraints).toEqual([cutoff]);
  });

  it('reads offset-free bounds in the query zone', async () => {
    // 12:00 in Tokyo is 03:00 UTC, before the 04:00 UTC end.
    const { instance, calls } = plane();
    await instance.invoke({ invocation: invocation(funnel({
      timezone: 'Asia/Tokyo',
      filters: [between('occurredAt', '2026-10-01T12:00:00', '2026-10-01T04:00:00Z')],
    })) });
    expect(calls).toHaveLength(1);
    const reversed = await failure(plane().instance.invoke({ invocation: invocation(funnel({
      filters: [between('occurredAt', '2026-10-01T12:00:00', '2026-10-01T04:00:00Z')],
    })) }));
    expect(reversed.message).toMatch(/exactly one bounded (time )?range/);
  });

  it('counts monthly cohorts in the query zone', async () => {
    // One UTC day that spans 30 September and 1 October in Los Angeles: two
    // monthly cohorts × two steps is four rows, over a budget of three.
    const operation = funnel({ by: 'month', filters: [between('occurredAt', '2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z')] });
    const budget = { maxRows: 3 };
    const { instance, calls } = plane();
    await instance.invoke({ invocation: { ...invocation(operation), budget } });
    expect(calls).toHaveLength(1);
    const error = await failure(plane().instance.invoke({
      invocation: { ...invocation({ ...operation, timezone: 'America/Los_Angeles' }), budget },
    }));
    expect(error.message).toMatch(/could return 4 rows; the limit is 3/);
  });

  it('applies the dimension ceiling to the entity and breakdown', async () => {
    const provider = await failure(plane({ limits: { maxDimensions: 1 } }).instance.invoke({
      invocation: invocation(funnel({ breakdown: ['plan'] })),
    }));
    expect(provider).toMatchObject({ category: 'input-invalid', path: '$.operation.breakdown' });
    expect(provider.message).toMatch(/At most 1 grouping fields/);
    const narrow = contract({ limits: { maxFilters: 8, maxDimensions: 2 } });
    const declared = await failure(plane({}, narrow).instance.invoke({
      invocation: invocation(funnel({ breakdown: ['plan', 'region'] })),
    }));
    expect(declared.message).toMatch(/At most 2 grouping fields/);
    const { instance, calls } = plane({}, narrow);
    await instance.invoke({ invocation: invocation(funnel({ breakdown: ['plan'] })) });
    expect(calls).toHaveLength(1);
  });

  it('refuses event operations when no event executor is wired', async () => {
    const { instance } = plane({ executeEventOperation: undefined });
    const error = await failure(instance.invoke({ invocation: invocation(funnel()) }));
    expect(error.category).toBe('unsupported-capability');
  });

  it('refuses a funnel on a dataset that declares no events', async () => {
    const withoutEvents = contract();
    delete (withoutEvents.datasets[0] as Record<string, unknown>).events;
    const { instance, calls } = plane({}, withoutEvents);
    const error = await failure(instance.invoke({ invocation: invocation(funnel()) }));
    expect(error).toMatchObject({ category: 'input-invalid', path: '$.operation.dataset' });
    expect(error.message).toMatch(/does not declare events/);
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['an unknown step field', funnel({ steps: [{ name: 'a', where: [eq('nope', 1)] }, { name: 'b', where: [eq('eventName', 'x')] }] }), '$.operation.steps[0].where[0]', /Unknown or unfilterable field "nope"/],
    ['a step on the time field', funnel({ steps: [{ name: 'a', where: [between('occurredAt', '2026-10-01', '2026-10-02')] }, { name: 'b', where: [eq('eventName', 'x')] }] }), '$.operation.steps[0].where[0]', /put the time range in filters/],
    ['no time range', funnel({ filters: [eq('plan', 'pro')] }), '$.operation.filters', /exactly one bounded (time )?range/],
    ['a half-open range', funnel({ filters: [{ ...eq('occurredAt', '2026-10-01'), operator: 'gte' }] }), '$.operation.filters', /exactly one bounded (time )?range/],
    ['a range over 731 days', funnel({ filters: [between('occurredAt', '2024-01-01', '2026-11-01')] }), '$.operation.filters', /at most 731 days/],
    ['a time-typed entity', funnel({ entity: 'occurredAt' }), '$.operation.entity', /non-groupable entity/],
    ['an unknown breakdown', funnel({ breakdown: ['country'] }), '$.operation.breakdown[0]', /non-groupable dimension "country"/],
    ['too many rows for the budget', funnel({ by: 'day', breakdown: ['plan'], breakdownLimit: 100 }), '$.operation', /could return 6400 rows; the limit is 500/],
    ['too many filters and conditions', funnel({ filters: [RANGE, ...Array.from({ length: 6 }, () => eq('plan', 'pro'))] }), '$.operation', /At most 8 filters and step conditions/],
  ])('refuses %s', async (_name, operation, path, message) => {
    const { instance, calls } = plane();
    const error = await failure(instance.invoke({ invocation: invocation(operation) }));
    expect(error.category).toBe('input-invalid');
    expect(error.path).toBe(path);
    expect(error.message).toMatch(message);
    expect(calls).toHaveLength(0);
  });

  it('refuses a hidden field exactly like an unknown one', async () => {
    const hidden = (field: string) => plane({
      resolveFieldVisibility: async () => ({
        kind: 'hypequery-field-visibility', version: 1,
        datasets: {
          activity: {
            dimensions: ['userId', 'accountId', 'eventName', 'plan', 'region', 'secret', 'occurredAt'].filter(name => name !== field),
            measures: ['events'],
          },
        },
      }),
    }).instance;
    const asStep = (field: string) => funnel({ steps: [{ name: 'a', where: [eq(field, 'x')] }, { name: 'b', where: [eq('eventName', 'x')] }] });
    const viaHidden = await failure(hidden('secret').invoke({ invocation: invocation(asStep('secret')) }));
    const viaUnknown = await failure(plane().instance.invoke({ invocation: invocation(asStep('missing')) }));
    expect(viaHidden.message).toBe(viaUnknown.message.replace('missing', 'secret'));
    const breakdownHidden = await failure(hidden('plan').invoke({ invocation: invocation(funnel({ breakdown: ['plan'] })) }));
    expect(breakdownHidden.message).toBe('Unknown or non-groupable dimension "plan".');
  });

  it('refuses a funnel sent as invocation 2', async () => {
    const error = await failure(plane().instance.invoke({ invocation: invocation(funnel(), 2) }));
    expect(error).toMatchObject({ category: 'input-invalid', code: 'HQ_SEMANTIC_INVOCATION_INVALID' });
  });

  it('bounds an executor that returns more rows than the budget', async () => {
    const { instance } = plane({
      executeEventOperation: async () => ({
        kind: 'hypequery-semantic-invocation-result', version: 1, activationRevision: REVISION,
        data: Array.from({ length: 501 }, () => ROWS[0]), meta: { rowCount: 501 },
      }),
    });
    const error = await failure(instance.invoke({ invocation: invocation(funnel()) }));
    expect(error.category).toBe('budget-exceeded');
  });
});

describe('funnel filters and conditions under RFC 0029', () => {
  const or = (...operands: unknown[]) => ({ kind: 'logical', operator: 'or', operands });
  const not = (operand: unknown) => ({ kind: 'logical', operator: 'not', operand });
  const relative = (value: string) => ({
    kind: 'comparison', operator: 'inDateRange', left: { kind: 'reference', name: 'occurredAt' }, right: { kind: 'literal', value },
  });
  const narrowed = contract({
    filters: [{ name: 'plan', field: 'plan', operators: ['eq'] }],
  });

  it('accepts and/or/not groups in filters and step conditions', async () => {
    const { instance, calls } = plane();
    await instance.invoke({ invocation: invocation(funnel({
      steps: [
        { name: 'signed_up', where: [or(eq('eventName', 'signup'), eq('eventName', 'sso_signup'))] },
        { name: 'first_query', where: [not(eq('plan', 'free')), eq('eventName', 'query_run')] },
      ],
      filters: [RANGE, or(eq('region', 'eu'), eq('region', 'us'))],
    })) });
    expect(calls).toHaveLength(1);
  });

  it('checks each leaf with the operator it applies after "not"', async () => {
    const error = await failure(plane({}, narrowed).instance.invoke({ invocation: invocation(funnel({
      filters: [RANGE, not(eq('plan', 'pro'))],
    })) }));
    expect(error).toMatchObject({ category: 'input-invalid', path: '$.operation.filters[1].operand.operator' });
    expect(error.message).toBe('Operator "neq" (the negation of "eq") is not allowed on "plan".');
    const inStep = await failure(plane().instance.invoke({ invocation: invocation(funnel({
      steps: [{ name: 'a', where: [or(eq('eventName', 'x'), eq('nope', 1))] }, { name: 'b', where: [eq('eventName', 'y')] }],
    })) }));
    expect(inStep).toMatchObject({ path: '$.operation.steps[0].where[0].operands[1]' });
    expect(inStep.message).toBe('Unknown or unfilterable field "nope".');
  });

  it('counts leaves against the filter budget', async () => {
    const error = await failure(plane().instance.invoke({ invocation: invocation(funnel({
      filters: [RANGE, or(eq('plan', 'a'), eq('plan', 'b'), eq('plan', 'c'), eq('plan', 'd'), eq('plan', 'e'), eq('plan', 'f'))],
    })) }));
    expect(error.message).toMatch(/At most 8 filters and step conditions/);
  });

  it('needs the time range at the top level', async () => {
    const error = await failure(plane().instance.invoke({ invocation: invocation(funnel({
      filters: [or(RANGE, eq('plan', 'pro'))],
    })) }));
    expect(error.message).toMatch(/need their time range as top-level filters/);
    expect(error.path).toBe('$.operation.filters[0].operands[0]');
  });

  it('accepts a top-level relative range and bounds its span without a clock', async () => {
    const { instance, calls } = plane();
    await instance.invoke({ invocation: invocation(funnel({ filters: [relative('last 30 days')], by: 'day' })) });
    expect(calls[0]!.operation.filters).toEqual([relative('last 30 days')]);
    const long = await failure(plane().instance.invoke({ invocation: invocation(funnel({ filters: [relative('last 3 years')] })) }));
    expect(long.message).toMatch(/at most 731 days/);
    // 'last 12 months' spans at most 372 days: 373 day cohorts × 2 steps > 500.
    const rows = await failure(plane().instance.invoke({ invocation: invocation(funnel({ filters: [relative('last 12 months')], by: 'day' })) }));
    expect(rows.message).toMatch(/could return 746 rows; the limit is 500/);
    // 'last 7 days' can straddle a month boundary wherever the clock puts it:
    // two monthly cohorts × two steps = 4 rows, over a budget of 3.
    const months = await failure(plane().instance.invoke({
      invocation: { ...invocation(funnel({ filters: [relative('last 7 days')], by: 'month' })), budget: { maxRows: 3 } },
    }));
    expect(months.message).toMatch(/could return 4 rows; the limit is 3/);
    const offAxis = await failure(plane().instance.invoke({ invocation: invocation(funnel({
      filters: [RANGE, { ...relative('today'), left: { kind: 'reference', name: 'plan' } }],
    })) }));
    expect(offAxis.message).toMatch(/"inDateRange" applies only to the time field "occurredAt"/);
  });
});

describe('funnel invocations end to end with the portable executor', () => {
  it('plans one tenant-scoped statement from the contract alone', async () => {
    const statements: { sql: string; parameters: unknown[] }[] = [];
    const factory: QueryBuilderFactoryLike = {
      table(table: string) {
        const parts: string[] = [];
        const chain = new Proxy({} as QueryBuilderLike, {
          get: (_target, property: string) => {
            if (property === 'toSQLWithParams') {
              return () => ({ sql: `SELECT ${parts.join(' ')} FROM ${table}`, parameters: [] });
            }
            return (...args: unknown[]) => {
              parts.push(`${property}(${args.filter(arg => arg !== undefined).map(String).join(',')})`);
              return chain;
            };
          },
        });
        return chain;
      },
      rawQuery: async <T = Record<string, unknown>>(sql: string, parameters: unknown[] = []): Promise<T[]> => {
        statements.push({ sql, parameters });
        return [{ _hq_r1: '12', _hq_r2: '3' }] as T[];
      },
    };
    const runtime = createPortableSemanticRuntime({ queryBuilder: factory });
    const { instance } = plane({
      execute: runtime.execute as never,
      executeEventOperation: runtime.executeEventOperation as never,
      resolveConstraints: async () => [{ ...eq('occurredAt', '2026-10-15'), operator: 'gte' }, eq('region', 'eu')],
    });
    const result = await instance.invoke({ invocation: invocation(funnel()) });
    expect(result.data).toEqual([
      { step: 'signed_up', step_index: 1, entities: 12, conversion_from_previous: 1, conversion_from_first: 1, dropoff: 0 },
      { step: 'first_query', step_index: 2, entities: 3, conversion_from_previous: 0.25, conversion_from_first: 0.25, dropoff: 9 },
    ]);
    expect(statements).toHaveLength(1);
    expect(statements[0]!.sql).toContain("windowFunnel(1814400000, 'strict_increase')");
    expect(statements[0]!.sql).toContain('where(analytics.activity.tenant_id,eq,acme)');
    // The trusted cutoff and region scope the scan without counting as a caller range.
    expect(statements[0]!.sql).toContain("where(toDateTime64(analytics.activity.occurredAt, 9, 'UTC'),gte,2026-10-15)");
    expect(statements[0]!.sql).toContain('where(analytics.activity.region,eq,eu)');
    expect(statements[0]!.parameters).toEqual(['signup', 'query_run']);
  });
});
