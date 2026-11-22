/**
 * RFC 0027 retention on ClickHouse, checked against cohorts computed directly
 * from the same generated events: each entity's cohort is the bucket of its
 * first start event in range, and it is retained in period p when it has a
 * return event in bucket cohort + p.
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

const TABLE = 'rfc0027_retention_events';
const REVISION = 'e'.repeat(64);
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

const DAY = 86_400_000;
const BASE = Date.UTC(2026, 0, 1);

function generate(): Event[] {
  let seed = 271828;
  const random = () => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648;
  const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;
  const events: Event[] = [];
  for (let user = 0; user < 900; user += 1) {
    const tenant = user % 9 === 0 ? 'b' : 'a';
    const plan = pick(['free', 'pro', null]);
    const joined = BASE + Math.floor(random() * 80) * DAY + Math.floor(random() * 24) * 3_600_000;
    // Some users sign up twice; the cohort is the first in range.
    events.push({ tenant, user: `u${user}`, account: user % 50, event: 'signup', plan, at: joined });
    if (random() < 0.2) events.push({ tenant, user: `u${user}`, account: user % 50, event: 'signup', plan, at: joined + 20 * DAY });
    let at = joined;
    while (random() < 0.75) {
      at += Math.floor(random() * 15 * DAY);
      events.push({ tenant, user: `u${user}`, account: user % 50, event: pick(['query_run', 'query_run', 'other']), plan: random() < 0.1 ? 'pro' : plan, at });
    }
  }
  // Boundary cases: a return in the cohort bucket itself never counts; one
  // in the next bucket does; one just before the range start is ignored.
  events.push({ tenant: 'a', user: 'edge', account: 1, event: 'query_run', plan: 'edge', at: BASE - 1 });
  events.push({ tenant: 'a', user: 'edge', account: 1, event: 'signup', plan: 'edge', at: BASE + 3 * DAY });
  events.push({ tenant: 'a', user: 'edge', account: 1, event: 'query_run', plan: 'edge', at: BASE + 3 * DAY + 1 });
  events.push({ tenant: 'a', user: 'edge', account: 1, event: 'query_run', plan: 'edge', at: BASE + 4 * DAY });
  return events;
}

const EVENTS = generate();
const RANGE_START = '2026-01-01';
const RANGE_END = '2026-04-01';

interface Scenario {
  grain: 'day' | 'week' | 'month';
  periods: number;
  returnKinds: readonly string[];
  breakdown?: 'plan';
  breakdownLimit?: number;
  timezone?: string;
  entity?: 'accountId';
  /** Use gte/lt instead of between, so the end is exclusive. */
  exclusiveEnd?: boolean;
}

function localDate(at: number, timezone: string): Date {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(at)).map(part => [part.type, part.value]));
  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
}

function bucket(at: number, grain: Scenario['grain'], timezone: string): string {
  const local = localDate(at, timezone);
  if (grain === 'month') local.setUTCDate(1);
  // ClickHouse toStartOfWeek mode 0: weeks start on Sunday.
  if (grain === 'week') local.setUTCDate(local.getUTCDate() - local.getUTCDay());
  return local.toISOString().slice(0, 10);
}

function shift(start: string, amount: number, grain: Scenario['grain']): string {
  const date = new Date(`${start}T00:00:00Z`);
  if (grain === 'day') date.setUTCDate(date.getUTCDate() + amount);
  if (grain === 'week') date.setUTCDate(date.getUTCDate() + 7 * amount);
  if (grain === 'month') date.setUTCMonth(date.getUTCMonth() + amount);
  return date.toISOString().slice(0, 10);
}

/** How far `timezone`'s wall clock is ahead of UTC at instant `at`. */
function zoneOffset(at: number, timezone: string): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(at)).map(part => [part.type, part.value]));
  const wall = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second));
  return wall - Math.floor(at / 1000) * 1000;
}

/** Local midnight of an ISO date in `timezone`, as an instant. */
function wallClock(date: string, timezone: string): number {
  const guess = Date.parse(`${date}T00:00:00Z`);
  return guess - zoneOffset(guess - zoneOffset(guess, timezone), timezone);
}

function expectedRows(scenario: Scenario): Record<string, unknown>[] {
  const timezone = scenario.timezone ?? 'UTC';
  const start = wallClock(RANGE_START, timezone);
  const end = wallClock(RANGE_END, timezone);
  const inRange = EVENTS.filter(event => event.tenant === 'a' && event.at >= start
    && (scenario.exclusiveEnd ? event.at < end : event.at <= end));
  const partitions = new Map<string, { key: unknown; events: Event[] }>();
  for (const event of inRange) {
    const entity = scenario.entity === 'accountId' ? String(event.account) : event.user;
    const key = scenario.breakdown ? event.plan : null;
    const id = JSON.stringify([entity, key]);
    if (!partitions.has(id)) partitions.set(id, { key, events: [] });
    partitions.get(id)!.events.push(event);
  }
  const cohorts = new Map<string, { key: unknown; cohort: string; size: number; retained: number[] }>();
  for (const { key, events } of partitions.values()) {
    const starts = events.filter(event => event.event === 'signup').map(event => event.at);
    if (starts.length === 0) continue;
    const cohort = bucket(Math.min(...starts), scenario.grain, timezone);
    const returns = new Set(events.filter(event => scenario.returnKinds.includes(event.event))
      .map(event => bucket(event.at, scenario.grain, timezone)));
    const id = JSON.stringify([key, cohort]);
    if (!cohorts.has(id)) cohorts.set(id, { key, cohort, size: 0, retained: Array.from({ length: scenario.periods }, () => 0) });
    const entry = cohorts.get(id)!;
    entry.size += 1;
    for (let period = 1; period <= scenario.periods; period += 1) {
      if (returns.has(shift(cohort, period, scenario.grain))) entry.retained[period - 1]! += 1;
    }
  }
  let ordered = [...cohorts.values()].sort((a, b) => (a.cohort < b.cohort ? -1 : a.cohort > b.cohort ? 1 : 0));
  if (scenario.breakdown) {
    const sizes = new Map<unknown, number>();
    for (const entry of ordered) sizes.set(entry.key, (sizes.get(entry.key) ?? 0) + entry.size);
    const ranked = [...sizes.entries()].sort(([a, sizeA], [b, sizeB]) => (
      sizeB - sizeA || (a === null ? 1 : b === null ? -1 : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0)
    )).map(([key]) => key).slice(0, scenario.breakdownLimit ?? 25);
    ordered = ordered.filter(entry => ranked.includes(entry.key))
      .sort((a, b) => ranked.indexOf(a.key) - ranked.indexOf(b.key) || (a.cohort < b.cohort ? -1 : 1));
  }
  return ordered.flatMap(entry => Array.from({ length: scenario.periods }, (_, index) => index + 1)
    // Only periods whose whole bucket ends by the range end are reported.
    .filter(period => wallClock(shift(entry.cohort, period + 1, scenario.grain), timezone) <= end)
    .map(period => ({
      ...(scenario.breakdown ? { plan: entry.key } : {}),
      cohort: entry.cohort,
      period,
      entities: entry.size,
      retained: entry.retained[period - 1],
      rate: entry.retained[period - 1]! / entry.size,
    })));
}

function operation(scenario: Scenario): ProtocolEventOperation {
  const reference = (name: string) => ({ kind: 'reference', name });
  const bound = (operator: string, value: string) => ({ kind: 'comparison', operator, left: reference('occurredAt'), right: { kind: 'literal', value } });
  return validateProtocolEventOperation({
    kind: 'retention',
    dataset: 'activity',
    ...(scenario.entity ? { entity: scenario.entity } : {}),
    start: { where: [{ kind: 'comparison', operator: 'eq', left: reference('eventName'), right: { kind: 'literal', value: 'signup' } }] },
    return: { where: [{
      kind: 'comparison', operator: 'in', left: reference('eventName'),
      right: { kind: 'literal', value: { $hypequery: { type: 'array', version: 1, values: [...scenario.returnKinds] } } },
    }] },
    grain: scenario.grain,
    periods: scenario.periods,
    filters: scenario.exclusiveEnd
      ? [bound('gte', RANGE_START), bound('lt', RANGE_END)]
      : [{
          kind: 'comparison', operator: 'between', left: reference('occurredAt'),
          right: { kind: 'literal', value: { $hypequery: { type: 'tuple', version: 1, values: [RANGE_START, RANGE_END] } } },
        }],
    ...(scenario.breakdown ? { breakdown: [scenario.breakdown] } : {}),
    ...(scenario.breakdownLimit ? { breakdownLimit: scenario.breakdownLimit } : {}),
    ...(scenario.timezone ? { timezone: scenario.timezone } : {}),
  });
}

const runtime = createPortableSemanticRuntime({ queryBuilder: db });
const deployment = buildProtocolDeploymentContract([Activity], {
  endpoints: { activity: { access: { kind: 'public' }, tenant: { kind: 'required', mode: 'auto-inject', column: 'tenant' } } },
});

async function run(scenario: Scenario) {
  const result = await runtime.executeEventOperation({
    deployment,
    dataset: deployment.datasets[0]!,
    operation: operation(scenario),
    tenant: 'a',
    budget: { maxRows: 10_000 },
    activationRevision: REVISION,
  });
  return result.data;
}

describe('RFC 0027 retention matches directly computed cohorts on ClickHouse', () => {
  beforeAll(async () => {
    await runSql(`DROP TABLE IF EXISTS ${TABLE}`);
    await runSql(`CREATE TABLE ${TABLE} (tenant String, user_id String, account_id UInt32, event String, plan Nullable(String), at DateTime64(3, 'UTC')) ENGINE = MergeTree ORDER BY (tenant, user_id, at)`);
    const values = EVENTS.map(event => `('${event.tenant}','${event.user}',${event.account},'${event.event}',${event.plan === null ? 'NULL' : `'${event.plan}'`},fromUnixTimestamp64Milli(${event.at}, 'UTC'))`);
    for (let index = 0; index < values.length; index += 700) {
      await runSql(`INSERT INTO ${TABLE} VALUES ${values.slice(index, index + 700).join(',')}`);
    }
  });
  afterAll(async () => { await runSql(`DROP TABLE IF EXISTS ${TABLE}`); });

  const scenarios: [string, Scenario][] = [
    ['weekly cohorts', { grain: 'week', periods: 8, returnKinds: ['query_run'] }],
    ['daily cohorts', { grain: 'day', periods: 14, returnKinds: ['query_run', 'other'] }],
    ['monthly cohorts with unobservable periods', { grain: 'month', periods: 6, returnKinds: ['query_run'] }],
    ['the start event also counts as a return', { grain: 'week', periods: 4, returnKinds: ['signup', 'query_run'] }],
    ['breakdown by a per-event value, top group only', { grain: 'week', periods: 6, returnKinds: ['query_run'], breakdown: 'plan', breakdownLimit: 1 }],
    ['breakdown with a null group', { grain: 'month', periods: 3, returnKinds: ['query_run'], breakdown: 'plan' }],
    ['weekly cohorts in a non-UTC zone', { grain: 'week', periods: 6, returnKinds: ['query_run'], timezone: 'Asia/Tokyo' }],
    ['daily cohorts across a DST change', { grain: 'day', periods: 10, returnKinds: ['query_run'], timezone: 'America/New_York' }],
    ['an exclusive range end', { grain: 'month', periods: 3, returnKinds: ['query_run'], exclusiveEnd: true }],
    ['accounts as the entity', { grain: 'week', periods: 6, returnKinds: ['query_run'], entity: 'accountId' }],
  ];

  it.each(scenarios)('%s', async (_name, scenario) => {
    const expected = expectedRows(scenario);
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.some(row => (row.retained as number) > 0)).toBe(true);
    expect(await run(scenario)).toEqual(expected);
  });

  it('never counts a return in the cohort bucket itself', async () => {
    const rows = await run({ grain: 'day', periods: 2, returnKinds: ['query_run'], breakdown: 'plan', breakdownLimit: 100 });
    // edge: cohort 2026-01-04; a return the same day doesn't count, the next day's does.
    expect(rows.filter(row => row.plan === 'edge')).toEqual([
      { plan: 'edge', cohort: '2026-01-04', period: 1, entities: 1, retained: 1, rate: 1 },
      { plan: 'edge', cohort: '2026-01-04', period: 2, entities: 1, retained: 0, rate: 0 },
    ]);
  });

  it('omits periods the range does not fully cover', async () => {
    const rows = await run({ grain: 'month', periods: 6, returnKinds: ['query_run'] });
    // The range ends on 1 April: February and March are whole, April is not.
    expect(rows.filter(row => row.cohort === '2026-01-01').map(row => row.period)).toEqual([1, 2]);
    expect(rows.filter(row => row.cohort === '2026-02-01').map(row => row.period)).toEqual([1]);
    expect(rows.filter(row => row.cohort === '2026-03-01')).toEqual([]);
  });
});
