import { Prng } from './utils/prng.js';
import { formatCents, formatDate, formatDateTime, utcSeconds } from './utils/format.js';

/**
 * Deterministic generator for the seed dataset.
 *
 * Everything derives from SEED through one PRNG, in a fixed order, so the
 * same code produces byte-identical rows on every machine. Change any
 * constant here and `checksums.json` must be regenerated on purpose.
 */
export const SEED = 20261101;

export const RANGE_START = utcSeconds(2025, 11, 1);
/** Exclusive. */
export const RANGE_END = utcSeconds(2026, 11, 1);
export const TENANT_COUNT = 200;
export const DEFAULT_EVENT_COUNT = 1_000_000;

const DAY = 86_400;
const EARLIEST_TENANT = utcSeconds(2024, 11, 1);

export type Plan = 'free' | 'starter' | 'growth' | 'enterprise';
export type Region = 'us-east' | 'us-west' | 'eu-west' | 'ap-south';

export interface TenantRow {
  tenant_id: number;
  name: string;
  plan: Plan;
  region: Region;
  industry: string;
  created_at: string;
}

export interface UserRow {
  user_id: number;
  tenant_id: number;
  email: string;
  role: 'admin' | 'member' | 'viewer';
  country: string;
  signed_up_at: string;
}

export interface EventRow {
  event_id: number;
  tenant_id: number;
  user_id: number;
  event_type: string;
  path: string;
  status_code: number;
  latency_ms: number;
  device: string;
  occurred_at: string;
}

export interface SubscriptionRow {
  subscription_id: number;
  tenant_id: number;
  plan: Exclude<Plan, 'free'>;
  status: 'active' | 'trialing' | 'past_due' | 'canceled';
  billing_interval: 'monthly' | 'annual';
  amount: string;
  currency: 'USD' | 'EUR' | 'GBP';
  started_at: string;
  ended_at: string | null;
}

interface TenantState {
  row: TenantRow;
  createdAt: number;
  activity: number;
  latencyFactor: number;
  slug: string;
}

interface UserState {
  row: UserRow;
  tenant: TenantState;
  signedUpAt: number;
  /** Epoch seconds after which the user stops producing events. */
  churnAt: number;
  weight: number;
}

const PLAN_WEIGHTS: ReadonlyArray<readonly [Plan, number]> = [
  ['free', 45],
  ['starter', 30],
  ['growth', 18],
  ['enterprise', 7],
];

const REGION_WEIGHTS: ReadonlyArray<readonly [Region, number]> = [
  ['us-east', 40],
  ['us-west', 20],
  ['eu-west', 28],
  ['ap-south', 12],
];

const REGION_COUNTRIES: Record<Region, ReadonlyArray<readonly [string, number]>> = {
  'us-east': [['US', 85], ['CA', 10], ['BR', 5]],
  'us-west': [['US', 80], ['CA', 12], ['MX', 8]],
  'eu-west': [['GB', 30], ['DE', 25], ['FR', 15], ['NL', 10], ['ES', 10], ['SE', 10]],
  'ap-south': [['IN', 45], ['SG', 20], ['AU', 20], ['JP', 15]],
};

const REGION_CURRENCY: Record<Region, SubscriptionRow['currency']> = {
  'us-east': 'USD',
  'us-west': 'USD',
  'eu-west': 'EUR',
  'ap-south': 'USD',
};

const INDUSTRIES = ['fintech', 'ecommerce', 'healthcare', 'media', 'logistics', 'education', 'gaming', 'devtools'];

const NAME_A = ['Acme', 'Northwind', 'Lumen', 'Harbor', 'Summit', 'Pioneer', 'Vector', 'Atlas', 'Beacon', 'Cobalt', 'Delta', 'Ember', 'Falcon', 'Granite', 'Helix', 'Iris', 'Juniper', 'Kestrel', 'Lattice', 'Meridian', 'Nimbus', 'Orbit', 'Pulse', 'Quartz', 'Relay', 'Sierra', 'Tandem', 'Umbra', 'Vista', 'Willow'];
const NAME_B = ['Labs', 'Analytics', 'Systems', 'Data', 'Cloud', 'Works', 'Metrics', 'Software', 'Digital', 'Insights'];

const PLAN_USERS: Record<Plan, readonly [number, number]> = {
  free: [2, 8],
  starter: [5, 25],
  growth: [20, 80],
  enterprise: [60, 250],
};

const PLAN_ACTIVITY: Record<Plan, number> = { free: 1, starter: 4, growth: 15, enterprise: 60 };

/** Monthly price in cents. Annual plans are billed 10x monthly, once a year. */
const PLAN_PRICE_CENTS: Record<Exclude<Plan, 'free'>, number> = {
  starter: 4_900,
  growth: 19_900,
  enterprise: 99_900,
};

const EVENT_TYPES: ReadonlyArray<readonly [string, number]> = [
  ['page_view', 45],
  ['api_call', 25],
  ['query_run', 15],
  ['login', 8],
  ['export', 4],
  ['error', 3],
];

const PAGE_PATHS = ['/dashboard', '/reports', '/settings', '/billing', '/explore', '/alerts', '/team'];
const API_PATHS = ['/api/v1/query', '/api/v1/events', '/api/v1/export', '/api/v1/users', '/api/v1/datasets'];

/** ln(ms) centre of the log-normal latency distribution per event type. */
const LATENCY_MU: Record<string, number> = {
  page_view: 4.6,
  api_call: 5.0,
  query_run: 6.2,
  login: 5.3,
  export: 7.0,
  error: 5.5,
};

const DEVICE_WEIGHTS: ReadonlyArray<readonly [string, number]> = [
  ['desktop', 65],
  ['mobile', 28],
  ['tablet', 7],
];

/** Relative traffic by UTC hour: business-hours peak, quiet nights. */
const HOUR_SHAPE = [0.25, 0.2, 0.18, 0.18, 0.22, 0.3, 0.45, 0.65, 0.85, 1.0, 1.0, 0.95, 0.9, 1.0, 1.0, 0.95, 0.9, 0.8, 0.65, 0.55, 0.45, 0.4, 0.35, 0.3];

function lowerBound(cumulative: Float64Array, target: number): number {
  let lo = 0;
  let hi = cumulative.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (cumulative[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export class SeedGenerator {
  private readonly rng = new Prng(SEED);
  readonly tenants: TenantState[] = [];
  readonly users: UserState[] = [];
  private userCumulative = new Float64Array(0);
  private userTotal = 0;

  constructor(readonly eventCount: number = DEFAULT_EVENT_COUNT) {
    this.generateTenants();
    this.generateUsers();
  }

  private generateTenants(): void {
    const seen = new Set<string>();
    for (let id = 1; id <= TENANT_COUNT; id += 1) {
      const plan = this.rng.weighted(PLAN_WEIGHTS);
      const region = this.rng.weighted(REGION_WEIGHTS);
      let name = `${this.rng.pick(NAME_A)} ${this.rng.pick(NAME_B)}`;
      if (seen.has(name)) name = `${name} ${id}`;
      seen.add(name);
      // Tenants arrive at a gently increasing rate (about 3x from the first
      // month to the last), so later cohorts are larger without the last
      // month dominating.
      const spanDays = (RANGE_END - DAY * 7 - EARLIEST_TENANT) / DAY;
      const position = this.rng.next() < 0.5 ? this.rng.next() : Math.sqrt(this.rng.next());
      const createdAt = EARLIEST_TENANT + Math.floor(position * spanDays) * DAY + this.rng.int(8 * 3600, 20 * 3600);
      this.tenants.push({
        row: {
          tenant_id: id,
          name,
          plan,
          region,
          industry: this.rng.pick(INDUSTRIES),
          created_at: formatDateTime(createdAt),
        },
        createdAt,
        activity: PLAN_ACTIVITY[plan] * (0.5 + this.rng.next()),
        latencyFactor: 0.8 + this.rng.next() * 0.5,
        slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      });
    }
  }

  private generateUsers(): void {
    let userId = 0;
    for (const tenant of this.tenants) {
      const [min, max] = PLAN_USERS[tenant.row.plan];
      const count = this.rng.int(min, max);
      for (let k = 0; k < count; k += 1) {
        userId += 1;
        // The first user signs up with the tenant; the rest trickle in. A
        // trickle that would land after the range is spread uniformly over
        // the tenant's lifetime instead of piling up on the last day.
        const latestSignup = RANGE_END - DAY - tenant.createdAt;
        let offset = k === 0 ? 0 : this.rng.exponential(120 * DAY);
        if (offset > latestSignup) offset = this.rng.next() * latestSignup;
        const signedUpAt = Math.floor(tenant.createdAt + Math.max(0, offset));
        // Retention: a long-tailed lifetime; some users never come back.
        const lifetime = this.rng.next() < 0.15 ? this.rng.int(1, 3) * DAY : this.rng.exponential(150 * DAY);
        const role = k === 0 ? 'admin' : this.rng.next() < 0.7 ? 'member' : 'viewer';
        const churnAt = signedUpAt + lifetime;
        // Events per active day are roughly constant per user, so the weight
        // scales with how long the user is active inside the event range.
        const activeDays = Math.max(0, Math.min(churnAt, RANGE_END) - Math.max(signedUpAt, RANGE_START)) / DAY;
        this.users.push({
          row: {
            user_id: userId,
            tenant_id: tenant.row.tenant_id,
            email: `user${userId}@${tenant.slug}.example`,
            role,
            country: this.rng.weighted(REGION_COUNTRIES[tenant.row.region]),
            signed_up_at: formatDateTime(signedUpAt),
          },
          tenant,
          signedUpAt,
          churnAt,
          weight: tenant.activity * this.rng.exponential(1) * (activeDays / 365),
        });
      }
    }
    this.userCumulative = new Float64Array(this.users.length);
    let total = 0;
    for (let i = 0; i < this.users.length; i += 1) {
      total += this.users[i].weight;
      this.userCumulative[i] = total;
    }
    this.userTotal = total;
  }

  tenantRows(): TenantRow[] {
    return this.tenants.map((t) => t.row);
  }

  userRows(): UserRow[] {
    return this.users.map((u) => u.row);
  }

  private pickUser(): UserState {
    return this.users[lowerBound(this.userCumulative, this.rng.next() * this.userTotal)];
  }

  /** Sample an event time for a user, or null if the user has no active window. */
  private sampleTime(user: UserState): number | null {
    const from = Math.max(user.signedUpAt, RANGE_START);
    const to = Math.min(user.churnAt, RANGE_END);
    if (to <= from) return null;
    const t = Math.floor(from + this.rng.next() * (to - from));
    // Shape by hour of day, weekday, and a steady growth trend.
    const date = new Date(t * 1000);
    const hourFactor = HOUR_SHAPE[date.getUTCHours()];
    const day = date.getUTCDay();
    const weekdayFactor = day === 0 || day === 6 ? 0.4 : 1;
    const trendFactor = 0.6 + 0.4 * ((t - RANGE_START) / (RANGE_END - RANGE_START));
    return this.rng.next() < hourFactor * weekdayFactor * trendFactor ? t : null;
  }

  /** Lazily yields event rows in insertion order. */
  *events(): Generator<EventRow> {
    for (let eventId = 1; eventId <= this.eventCount; eventId += 1) {
      let user = this.pickUser();
      let time = this.sampleTime(user);
      while (time === null) {
        user = this.pickUser();
        time = this.sampleTime(user);
      }
      const eventType = this.rng.weighted(EVENT_TYPES);
      const device = eventType === 'api_call' ? 'api' : this.rng.weighted(DEVICE_WEIGHTS);
      let path: string;
      switch (eventType) {
        case 'api_call':
          path = this.rng.pick(API_PATHS);
          break;
        case 'query_run':
          path = '/explore';
          break;
        case 'login':
          path = '/login';
          break;
        case 'export':
          path = '/export';
          break;
        default:
          path = this.rng.pick(PAGE_PATHS);
      }
      let statusCode: number;
      if (eventType === 'error') {
        statusCode = this.rng.weighted([[500, 50], [502, 15], [503, 15], [429, 10], [404, 10]]);
      } else {
        const roll = this.rng.next();
        statusCode = roll < 0.96 ? 200 : roll < 0.97 ? 201 : roll < 0.985 ? 400 : roll < 0.995 ? 401 : 404;
      }
      const latency = Math.exp(this.rng.gaussian(LATENCY_MU[eventType], 0.6)) * user.tenant.latencyFactor;
      yield {
        event_id: eventId,
        tenant_id: user.tenant.row.tenant_id,
        user_id: user.row.user_id,
        event_type: eventType,
        path,
        status_code: statusCode,
        latency_ms: Math.min(60_000, Math.max(1, Math.round(latency))),
        device,
        occurred_at: formatDateTime(time),
      };
    }
  }

  /**
   * Subscription periods. Must run after events(): it consumes the PRNG, so
   * the order of calls is part of the contract. `seed.ts` calls tenants,
   * users, events, subscriptions in that order.
   */
  subscriptionRows(): SubscriptionRow[] {
    const rows: SubscriptionRow[] = [];
    let subscriptionId = 0;
    const planOrder: Array<Exclude<Plan, 'free'>> = ['starter', 'growth', 'enterprise'];

    for (const tenant of this.tenants) {
      const currency = REGION_CURRENCY[tenant.row.region];
      const interval: SubscriptionRow['billing_interval'] = this.rng.next() < 0.3 ? 'annual' : 'monthly';
      const price = (plan: Exclude<Plan, 'free'>) =>
        formatCents(interval === 'annual' ? PLAN_PRICE_CENTS[plan] * 10 : PLAN_PRICE_CENTS[plan]);
      const trialEnd = tenant.createdAt + 14 * DAY;

      if (tenant.row.plan === 'free') {
        // One in ten free tenants once paid and churned back to free.
        if (this.rng.next() < 0.1 && trialEnd + 60 * DAY < RANGE_END) {
          const endedAt = trialEnd + this.rng.int(30, 240) * DAY;
          subscriptionId += 1;
          rows.push({
            subscription_id: subscriptionId,
            tenant_id: tenant.row.tenant_id,
            plan: 'starter',
            status: 'canceled',
            billing_interval: interval,
            amount: price('starter'),
            currency,
            started_at: formatDate(trialEnd),
            ended_at: formatDate(Math.min(endedAt, RANGE_END - DAY)),
          });
        }
        continue;
      }

      const finalPlan = tenant.row.plan;
      const stillTrialing = trialEnd > RANGE_END - DAY;
      if (stillTrialing) {
        subscriptionId += 1;
        rows.push({
          subscription_id: subscriptionId,
          tenant_id: tenant.row.tenant_id,
          plan: finalPlan,
          status: 'trialing',
          billing_interval: interval,
          amount: price(finalPlan),
          currency,
          started_at: formatDate(tenant.createdAt),
          ended_at: null,
        });
        continue;
      }

      // A quarter of paying tenants upgraded once from the plan below.
      const finalIndex = planOrder.indexOf(finalPlan);
      const upgraded = finalIndex > 0 && this.rng.next() < 0.25 && trialEnd + 60 * DAY < RANGE_END;
      let currentStart = trialEnd;
      if (upgraded) {
        const upgradeAt = trialEnd + this.rng.int(30, Math.floor((RANGE_END - DAY - trialEnd) / DAY)) * DAY;
        const previousPlan = planOrder[finalIndex - 1];
        subscriptionId += 1;
        rows.push({
          subscription_id: subscriptionId,
          tenant_id: tenant.row.tenant_id,
          plan: previousPlan,
          status: 'canceled',
          billing_interval: interval,
          amount: price(previousPlan),
          currency,
          started_at: formatDate(trialEnd),
          ended_at: formatDate(upgradeAt),
        });
        currentStart = upgradeAt;
      }

      const roll = this.rng.next();
      let status: SubscriptionRow['status'] = 'active';
      let endedAt: string | null = null;
      if (roll < 0.12 && currentStart + 30 * DAY < RANGE_END) {
        status = 'canceled';
        endedAt = formatDate(currentStart + this.rng.int(30, Math.floor((RANGE_END - DAY - currentStart) / DAY)) * DAY);
      } else if (roll < 0.17) {
        status = 'past_due';
      }
      subscriptionId += 1;
      rows.push({
        subscription_id: subscriptionId,
        tenant_id: tenant.row.tenant_id,
        plan: finalPlan,
        status,
        billing_interval: interval,
        amount: price(finalPlan),
        currency,
        started_at: formatDate(currentStart),
        ended_at: endedAt,
      });
    }
    return rows;
  }
}
