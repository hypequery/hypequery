/**
 * RFC 0027 funnels on ClickHouse, checked against a brute-force sequence
 * search over the same generated events.
 *
 * The generator packs many events into few distinct timestamps, so ties,
 * events that satisfy two steps, and chains that only survive with a later
 * start are all common. The search enumerates every chain, so it shares no
 * logic with the planner's `windowFunnel` transform.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProtocolEventOperation } from '@hypequery/protocol';
import { validateProtocolEventOperation } from '@hypequery/protocol';
import { createQueryBuilder } from '../../../../clickhouse/src/index.js';
import { dataset } from '../../dataset.js';
import { dimension } from '../../field.js';
import { measure } from '../../measure.js';
import { buildProtocolDeploymentContract } from '../../protocol-deployment-adapter.js';
import { createPortableSemanticRuntime } from '../../portable-executor.js';
import { TEST_CONNECTION_CONFIG, runSql } from '../../../../../testing/clickhouse/harness.mjs';

const TABLE = 'rfc0027_funnel_events';
const REVISION = 'f'.repeat(64);
const db = createQueryBuilder({
  host: TEST_CONNECTION_CONFIG.host, username: TEST_CONNECTION_CONFIG.user,
  password: TEST_CONNECTION_CONFIG.password, database: TEST_CONNECTION_CONFIG.database,
});

const Activity = dataset('activity', {
  source: TABLE,
  tenantKey: 'tenant',
  timeKey: 'occurredAt',
  events: { entity: 'userId', event: 'eventName' },
  dimensions: {
    userId: dimension.string({ column: 'user_id' }),
    accountId: dimension.number({ column: 'account_id' }),
    eventName: dimension.string({ column: 'event' }),
    plan: dimension.string({ column: 'plan' }),
    occurredAt: dimension.timestamp({ column: 'at' }),
  },
  measures: { events: measure.count('userId') },
});

interface Event { tenant: string; user: string; account: number; event: string; plan: string | null; at: number }

const BASE = Date.UTC(2026, 9, 1);
const MINUTE = 60_000;
const KINDS = ['signup', 'sso', 'invite', 'query', 'other'];

function generate(): Event[] {
  let seed = 20261122;
  const random = () => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648;
  const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;
  const events: Event[] = [];
  for (let user = 0; user < 700; user += 1) {
    const tenant = user % 7 === 0 ? 'b' : 'a';
    const count = 1 + Math.floor(random() * 10);
    // Each user is active on one or two days, so day cohorts differ.
    const day = Math.floor(random() * 20) * 86_400_000;
    for (let index = 0; index < count; index += 1) {
      events.push({
        tenant, user: `u${user}`, account: user % 40, event: pick(KINDS),
        plan: pick(['free', 'pro', 'team', null]),
        // Few distinct instants: ties are the rule, not the exception.
        at: BASE + day + Math.floor(random() * 30) * MINUTE + (random() < 0.2 ? 86_400_000 : 0),
      });
    }
  }
  // Window edges: exactly at the window, and one millisecond past it.
  const edge = (user: string, offsets: readonly [string, number][]) => offsets.forEach(([event, offset]) => {
    events.push({ tenant: 'a', user, account: 99, event, plan: 'edge', at: BASE + offset });
  });
  edge('edge_inclusive', [['signup', 0], ['invite', 5 * MINUTE], ['query', 10 * MINUTE]]);
  edge('edge_exclusive', [['signup', 0], ['invite', 5 * MINUTE], ['query', 10 * MINUTE + 1]]);
  edge('edge_tie', [['signup', 3 * MINUTE], ['invite', 3 * MINUTE], ['query', 4 * MINUTE]]);
  edge('edge_restart', [['signup', 0], ['signup', 8 * MINUTE], ['invite', 12 * MINUTE], ['query', 17 * MINUTE]]);
  return events;
}

const EVENTS = generate();
const RANGE_START = '2026-10-01T00:00:00Z';
const RANGE_END = '2026-10-15T00:00:00Z';

type Condition = (event: Event) => boolean;
interface Scenario {
  steps: { name: string; kinds: readonly string[] }[];
  windowMinutes: number;
  order: 'strict' | 'any';
  breakdown?: 'plan';
  breakdownLimit?: number;
  by?: 'day' | 'week' | 'month';
  timezone?: string;
  excludeTeam?: boolean;
  entity?: 'accountId';
  /** RFC 0029: steps as `or` groups, the team exclusion as `not`, the range as `inDateRange`. */
  booleanFilters?: boolean;
  relativeRange?: boolean;
}

/** The runtime's clock for relative ranges: "last 14 days" is [1 Oct, 15 Oct). */
const NOW = new Date('2026-10-15T12:00:00Z');

function bruteForceLevel(events: readonly Event[], steps: readonly Condition[], window: number, order: 'strict' | 'any'): number {
  let best = 0;
  if (order === 'strict') {
    const extend = (level: number, start: number, last: number) => {
      best = Math.max(best, level);
      if (level === steps.length) return;
      for (const event of events) {
        if (steps[level]!(event) && event.at > last && event.at <= start + window) extend(level + 1, start, event.at);
      }
    };
    for (const event of events) if (steps[0]!(event)) extend(1, event.at, event.at);
    return best;
  }
  for (const anchor of events) {
    let level = 0;
    while (level < steps.length && events.some(event => (
      steps[level]!(event) && event.at >= anchor.at && event.at <= anchor.at + window
    ))) level += 1;
    best = Math.max(best, level);
  }
  return best;
}

function bucket(at: number, grain: 'day' | 'week' | 'month', timezone = 'UTC'): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(at)).map(part => [part.type, part.value]));
  const local = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  if (grain === 'month') local.setUTCDate(1);
  // ClickHouse toStartOfWeek mode 0: weeks start on Sunday.
  if (grain === 'week') local.setUTCDate(local.getUTCDate() - local.getUTCDay());
  return local.toISOString().slice(0, 10);
}

function expectedRows(scenario: Scenario): Record<string, unknown>[] {
  const inRange = EVENTS.filter(event => event.tenant === 'a'
    && event.at >= Date.parse(RANGE_START)
    // A relative range ends at today's midnight, exclusively.
    && (scenario.relativeRange ? event.at < Date.parse(RANGE_END) : event.at <= Date.parse(RANGE_END))
    // SQL `plan != 'team'` is NULL for a NULL plan, so those rows drop too.
    && (!scenario.excludeTeam || (event.plan !== null && event.plan !== 'team')));
  const steps: Condition[] = scenario.steps.map(step => event => step.kinds.includes(event.event));
  const partitions = new Map<string, { key: unknown; events: Event[] }>();
  for (const event of inRange) {
    const entity = scenario.entity === 'accountId' ? String(event.account) : event.user;
    const key = scenario.breakdown ? event.plan : null;
    const id = JSON.stringify([entity, key]);
    if (!partitions.has(id)) partitions.set(id, { key, events: [] });
    partitions.get(id)!.events.push(event);
  }
  const groups = new Map<string, { key: unknown; cohort: string | null; reached: number[] }>();
  for (const { key, events } of partitions.values()) {
    const level = bruteForceLevel(events, steps, scenario.windowMinutes * MINUTE, scenario.order);
    if (level === 0 && (scenario.breakdown || scenario.by)) continue;
    const firstStep = Math.min(...events.filter(steps[0]!).map(event => event.at));
    const cohort = scenario.by && Number.isFinite(firstStep) ? bucket(firstStep, scenario.by, scenario.timezone) : null;
    const id = JSON.stringify([key, cohort]);
    if (!groups.has(id)) groups.set(id, { key, cohort, reached: scenario.steps.map(() => 0) });
    for (let index = 0; index < level; index += 1) groups.get(id)!.reached[index]! += 1;
  }
  if (groups.size === 0 && !scenario.breakdown && !scenario.by) {
    groups.set('[]', { key: null, cohort: null, reached: scenario.steps.map(() => 0) });
  }
  let ordered = [...groups.values()];
  if (scenario.breakdown) {
    const sizes = new Map<unknown, number>();
    for (const group of ordered) sizes.set(group.key, (sizes.get(group.key) ?? 0) + group.reached[0]!);
    const ranked = [...sizes.entries()].sort(([a, sizeA], [b, sizeB]) => (
      sizeB - sizeA || (a === null ? 1 : b === null ? -1 : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0)
    )).map(([key]) => key).slice(0, scenario.breakdownLimit ?? 25);
    ordered = ordered.filter(group => ranked.includes(group.key))
      .sort((a, b) => ranked.indexOf(a.key) - ranked.indexOf(b.key));
  }
  if (scenario.by) ordered.sort((a, b) => (a.cohort! < b.cohort! ? -1 : a.cohort! > b.cohort! ? 1 : 0));
  return ordered.flatMap(group => scenario.steps.map((step, index) => {
    const entities = group.reached[index]!;
    const previous = index === 0 ? entities : group.reached[index - 1]!;
    return {
      ...(scenario.by ? { cohort: group.cohort } : {}),
      ...(scenario.breakdown ? { plan: group.key } : {}),
      step: step.name,
      step_index: index + 1,
      entities,
      conversion_from_previous: index === 0 ? (entities === 0 ? null : 1) : previous === 0 ? null : entities / previous,
      conversion_from_first: group.reached[0] === 0 ? null : entities / group.reached[0]!,
      dropoff: index === 0 ? 0 : previous - entities,
    };
  }));
}

function operation(scenario: Scenario): ProtocolEventOperation {
  const equals = (field: string, value: string) => ({
    kind: 'comparison', operator: 'eq', left: { kind: 'reference', name: field }, right: { kind: 'literal', value },
  });
  const condition = (kinds: readonly string[]) => (scenario.booleanFilters && kinds.length > 1
    ? { kind: 'logical', operator: 'or', operands: kinds.map(kind => equals('eventName', kind)) }
    : kinds.length === 1
    ? { kind: 'comparison', operator: 'eq', left: { kind: 'reference', name: 'eventName' }, right: { kind: 'literal', value: kinds[0] } }
    : {
        kind: 'comparison', operator: 'in', left: { kind: 'reference', name: 'eventName' },
        right: { kind: 'literal', value: { $hypequery: { type: 'array', version: 1, values: [...kinds] } } },
      });
  return validateProtocolEventOperation({
    kind: 'funnel',
    dataset: 'activity',
    ...(scenario.entity ? { entity: scenario.entity } : {}),
    steps: scenario.steps.map(step => ({ name: step.name, where: [condition(step.kinds)] })),
    window: `${scenario.windowMinutes} minute`,
    order: scenario.order,
    filters: [
      scenario.relativeRange
        ? { kind: 'comparison', operator: 'inDateRange', left: { kind: 'reference', name: 'occurredAt' }, right: { kind: 'literal', value: 'last 14 days' } }
        : {
            kind: 'comparison', operator: 'between', left: { kind: 'reference', name: 'occurredAt' },
            right: { kind: 'literal', value: { $hypequery: { type: 'tuple', version: 1, values: [RANGE_START, RANGE_END] } } },
          },
      ...(scenario.excludeTeam
        ? [scenario.booleanFilters
            ? { kind: 'logical', operator: 'not', operand: equals('plan', 'team') }
            : { kind: 'comparison', operator: 'neq', left: { kind: 'reference', name: 'plan' }, right: { kind: 'literal', value: 'team' } }]
        : []),
    ],
    ...(scenario.breakdown ? { breakdown: [scenario.breakdown] } : {}),
    ...(scenario.breakdownLimit ? { breakdownLimit: scenario.breakdownLimit } : {}),
    ...(scenario.by ? { by: scenario.by } : {}),
    ...(scenario.timezone ? { timezone: scenario.timezone } : {}),
  });
}

const runtime = createPortableSemanticRuntime({ queryBuilder: db, now: () => NOW });
const deployment = buildProtocolDeploymentContract([Activity], {
  endpoints: { activity: { access: { kind: 'public' }, tenant: { kind: 'required', mode: 'auto-inject', column: 'tenant' } } },
});

async function run(scenario: Scenario) {
  const contract = deployment.datasets.find(entry => String(entry.name) === 'activity')!;
  const result = await runtime.executeEventOperation({
    deployment,
    dataset: contract,
    operation: operation(scenario),
    tenant: 'a',
    budget: { maxRows: 10_000 },
    activationRevision: REVISION,
  });
  return result.data;
}

const THREE_STEPS = [
  { name: 'signed_up', kinds: ['signup'] },
  { name: 'invited', kinds: ['invite'] },
  { name: 'queried', kinds: ['query'] },
];
const OVERLAPPING = [
  { name: 'entered', kinds: ['signup', 'sso'] },
  { name: 'engaged', kinds: ['sso', 'invite'] },
  { name: 'queried', kinds: ['query', 'invite'] },
  { name: 'returned', kinds: ['other'] },
];

describe('RFC 0027 funnels match a brute-force sequence search on ClickHouse', () => {
  beforeAll(async () => {
    await runSql(`DROP TABLE IF EXISTS ${TABLE}`);
    await runSql(`CREATE TABLE ${TABLE} (tenant String, user_id String, account_id UInt32, event String, plan Nullable(String), at DateTime64(3, 'UTC')) ENGINE = MergeTree ORDER BY (tenant, user_id, at)`);
    const values = EVENTS.map(event => `('${event.tenant}','${event.user}',${event.account},'${event.event}',${event.plan === null ? 'NULL' : `'${event.plan}'`},fromUnixTimestamp64Milli(${event.at}, 'UTC'))`);
    // Several inserts, so parts (and the order windowFunnel reads ties in) vary.
    for (let index = 0; index < values.length; index += 500) {
      await runSql(`INSERT INTO ${TABLE} VALUES ${values.slice(index, index + 500).join(',')}`);
    }
  });
  afterAll(async () => { await runSql(`DROP TABLE IF EXISTS ${TABLE}`); });

  const scenarios: [string, Scenario][] = [
    ['strict order with ties and window edges', { steps: THREE_STEPS, windowMinutes: 10, order: 'strict' }],
    ['or-group steps and a not filter (RFC 0029)', { steps: OVERLAPPING, windowMinutes: 15, order: 'strict', excludeTeam: true, booleanFilters: true }],
    ['any order with or-group steps (RFC 0029)', { steps: OVERLAPPING, windowMinutes: 15, order: 'any', booleanFilters: true }],
    ['a relative range resolved at the executor (RFC 0029)', { steps: THREE_STEPS, windowMinutes: 30, order: 'strict', by: 'day', relativeRange: true }],
    ['strict order with one-minute windows', { steps: THREE_STEPS, windowMinutes: 1, order: 'strict' }],
    ['strict order where one event satisfies several steps', { steps: OVERLAPPING, windowMinutes: 15, order: 'strict' }],
    ['any order', { steps: THREE_STEPS, windowMinutes: 10, order: 'any' }],
    ['any order where one event satisfies several steps', { steps: OVERLAPPING, windowMinutes: 15, order: 'any' }],
    ['breakdown by a per-event value, top two groups', { steps: THREE_STEPS, windowMinutes: 20, order: 'strict', breakdown: 'plan', breakdownLimit: 2 }],
    ['breakdown with a null group', { steps: THREE_STEPS, windowMinutes: 20, order: 'any', breakdown: 'plan' }],
    ['daily cohort trend', { steps: THREE_STEPS, windowMinutes: 30, order: 'strict', by: 'day' }],
    ['weekly cohorts with breakdown', { steps: THREE_STEPS, windowMinutes: 30, order: 'strict', by: 'week', breakdown: 'plan' }],
    ['daily cohorts in a non-UTC zone', { steps: THREE_STEPS, windowMinutes: 30, order: 'strict', by: 'day', timezone: 'America/Los_Angeles' }],
    ['an extra filter on every event', { steps: THREE_STEPS, windowMinutes: 10, order: 'strict', excludeTeam: true }],
    ['accounts as the entity', { steps: THREE_STEPS, windowMinutes: 10, order: 'strict', entity: 'accountId' }],
  ];

  it.each(scenarios)('%s', async (_name, scenario) => {
    const expected = expectedRows(scenario);
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.some(row => row.step_index === 2 && (row.entities as number) > 0)).toBe(true);
    expect(await run(scenario)).toEqual(expected);
  });

  it('counts a step exactly at the window and not one millisecond past it', async () => {
    const events = (user: string) => EVENTS.filter(event => event.user === user);
    const steps: Condition[] = THREE_STEPS.map(step => event => step.kinds.includes(event.event));
    expect(bruteForceLevel(events('edge_inclusive'), steps, 10 * MINUTE, 'strict')).toBe(3);
    expect(bruteForceLevel(events('edge_exclusive'), steps, 10 * MINUTE, 'strict')).toBe(2);
    expect(bruteForceLevel(events('edge_tie'), steps, 10 * MINUTE, 'strict')).toBe(1);
    expect(bruteForceLevel(events('edge_restart'), steps, 10 * MINUTE, 'strict')).toBe(3);
    const rows = await run({ steps: THREE_STEPS, windowMinutes: 10, order: 'strict', breakdown: 'plan', breakdownLimit: 100 });
    const edge = rows.filter(row => row.plan === 'edge').map(row => row.entities);
    // edge_inclusive and edge_restart reach step 3; edge_exclusive stops at 2; edge_tie at 1.
    expect(edge).toEqual([4, 3, 2]);
  });

  it('never counts another tenant', async () => {
    const rows = await run({ steps: THREE_STEPS, windowMinutes: 10, order: 'strict' });
    const tenantA = new Set(EVENTS.filter(event => event.tenant === 'a' && event.event === 'signup').map(event => event.user));
    expect(rows[0]!.entities).toBeLessThanOrEqual(tenantA.size);
    expect(rows[0]!.entities).toBe(expectedRows({ steps: THREE_STEPS, windowMinutes: 10, order: 'strict' })[0]!.entities);
  });

  it('reports zero at every step when no entity entered the funnel', async () => {
    const rows = await run({ steps: [{ name: 'a', kinds: ['never'] }, { name: 'b', kinds: ['query'] }], windowMinutes: 10, order: 'strict' });
    expect(rows).toEqual([
      { step: 'a', step_index: 1, entities: 0, conversion_from_previous: null, conversion_from_first: null, dropoff: 0 },
      { step: 'b', step_index: 2, entities: 0, conversion_from_previous: null, conversion_from_first: null, dropoff: 0 },
    ]);
  });
});
