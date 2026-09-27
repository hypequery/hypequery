/**
 * Customer-shaped schema 1: B2B product analytics, one customer per database.
 *
 * Modelled on a SaaS company instrumenting its own product: a wide event table
 * keyed by account, a small accounts dimension table, and funnel measures built
 * from filtered counts. There is no tenant column — isolation between customers
 * is the deployment target, not a predicate — so this is the cross-customer
 * shape: every customer runs the same contract against their own tables.
 *
 * ClickHouse DDL this mirrors:
 *
 *   CREATE TABLE product.events (
 *     event_time DateTime64(3), account_id UInt64, user_id String,
 *     session_id String, event_name LowCardinality(String),
 *     platform LowCardinality(String), country_code FixedString(2),
 *     duration_ms UInt32, revenue_micros Int64
 *   ) ENGINE = MergeTree ORDER BY (account_id, event_time);
 *
 *   CREATE TABLE product.accounts (
 *     account_id UInt64, plan LowCardinality(String),
 *     industry LowCardinality(String), seats UInt32, created_at DateTime
 *   ) ENGINE = ReplacingMergeTree ORDER BY account_id;
 */

import { dataset } from '../../../dataset.js';
import { dimension } from '../../../field.js';
import { divide, nullIfZero, round } from '../../../formulas.js';
import { measure } from '../../../measure.js';
import { eq } from '../../../query-helpers.js';
import { belongsTo } from '../../../relationships.js';
import type { MetricHandle, TimeGrain } from '../../../types.js';

export const Accounts = dataset('accounts', {
  source: 'product.accounts',
  dimensions: {
    id: dimension.number({ column: 'account_id' }),
    plan: dimension.string(),
    industry: dimension.string(),
    seats: dimension.number({ groupable: false }),
    createdAt: dimension.timestamp({ column: 'created_at' }),
  },
});

export const Events = dataset('events', {
  source: 'product.events',
  timeKey: 'eventTime',
  dimensions: {
    eventTime: dimension.timestamp({ column: 'event_time' }),
    accountId: dimension.number({ column: 'account_id' }),
    userId: dimension.string({ column: 'user_id' }),
    sessionId: dimension.string({ column: 'session_id', groupable: false }),
    eventName: dimension.string({ column: 'event_name' }),
    platform: dimension.string(),
    country: dimension.string({ column: 'country_code' }),
    isMobile: dimension.boolean({
      sql: "platform IN ('ios', 'android')",
      dependencies: ['platform'],
    }),
    durationMs: dimension.number({ column: 'duration_ms', groupable: false }),
    revenueMicros: dimension.number({ column: 'revenue_micros', groupable: false }),
  },
  measures: {
    events: measure.count('eventName'),
    activeUsers: measure.countDistinct('userId'),
    sessions: measure.countDistinct('sessionId'),
    totalDuration: measure.sum('durationMs'),
    avgDuration: measure.avg('durationMs'),
    medianDuration: measure.percentile('durationMs', 0.5),
    p99Duration: measure.percentile('durationMs', 0.99),
    longestSession: measure.max('durationMs'),
    signups: measure.count('userId', { filters: [eq('eventName', 'signup')] }),
    activations: measure.countDistinct('userId', { filters: [eq('eventName', 'activated')] }),
    revenue: measure.sum('revenueMicros'),
    busiestPlatform: measure.argMax('platform', 'durationMs'),
    durationPerSession: measure.derived({
      uses: { duration: 'totalDuration', sessions: 'sessions' },
      formula: ({ duration, sessions }) => divide(duration, nullIfZero(sessions)),
    }),
  },
  filters: {
    eventName: { __type: 'filter_definition', field: 'eventName', operators: ['eq', 'neq', 'in', 'notIn'] },
    platform: { __type: 'filter_definition', field: 'platform', operators: ['eq', 'in'] },
    country: { __type: 'filter_definition', field: 'country', operators: ['eq', 'in', 'like'] },
    eventTime: { __type: 'filter_definition', field: 'eventTime', operators: ['gte', 'lt', 'between'] },
  },
  relationships: {
    account: belongsTo(() => Accounts, { from: 'account_id', to: 'account_id' }),
  },
  limits: { maxDimensions: 5, maxMeasures: 6, maxFilters: 4, maxResultSize: 10_000 },
});

const signupsInput = Events.metric('signups', { measure: 'signups' });
const activationsInput = Events.metric('activations', { measure: 'activations' });
const durationInput = Events.metric('duration', { measure: 'totalDuration' });
const sessionsInput = Events.metric('sessions', { measure: 'sessions' });
const usersInput = Events.metric('users', { measure: 'activeUsers' });
const revenueInput = Events.metric('revenue', { measure: 'revenue' });

function grained(handle: unknown, grain: TimeGrain): MetricHandle {
  return (handle as { by(grain: TimeGrain): MetricHandle }).by(grain);
}

export const productMetrics: Record<string, MetricHandle> = {
  dailyActiveUsers: grained(Events.metric('dailyActiveUsers', { measure: 'activeUsers' }), 'day'),
  weeklyActiveUsers: grained(Events.metric('weeklyActiveUsers', { measure: 'activeUsers' }), 'week'),
  signups: Events.metric('signups', { measure: 'signups' }) as MetricHandle,
  activationRate: Events.metric('activationRate', {
    uses: { activations: activationsInput, signups: signupsInput },
    formula: ({ activations, signups }) => round(divide(activations, nullIfZero(signups)), 4),
  }) as MetricHandle,
  avgSessionLength: Events.metric('avgSessionLength', {
    uses: { duration: durationInput, sessions: sessionsInput },
    formula: ({ duration, sessions }) => divide(duration, nullIfZero(sessions)),
  }) as MetricHandle,
  arpu: Events.metric('arpu', {
    uses: { revenue: revenueInput, users: usersInput },
    formula: ({ revenue, users }) => divide(revenue, nullIfZero(users)),
  }) as MetricHandle,
  monthlyActivationRate: grained(Events.metric('monthlyActivationRate', {
    uses: { activations: activationsInput, signups: signupsInput },
    formula: ({ activations, signups }) => divide(activations, nullIfZero(signups)),
  }), 'month'),
};
