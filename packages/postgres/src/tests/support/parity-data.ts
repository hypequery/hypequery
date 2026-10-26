/**
 * Deterministic rows for the cross-engine parity suite. They cover 2025 (so
 * year-over-year shifts have history) through April 2026, NULL statuses and
 * customers, two tenants, and the New York DST transitions of March 2026.
 */

export interface ParityOrder {
  readonly tenant_id: string;
  readonly customer_id: number | null;
  readonly status: string | null;
  readonly region_code: string;
  readonly is_gift: boolean;
  readonly amount_cents: number;
  /** UTC instant, `YYYY-MM-DD HH:MM:SS.mmm`. */
  readonly created_at: string;
}

export interface ParityCustomer {
  readonly customer_id: number;
  readonly tenant_id: string;
  readonly country_code: string;
  readonly tier: string;
}

/** Mulberry32: a small seeded PRNG, so both engines get identical rows. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STATUSES = ['paid', 'shipped', 'refunded', "paid's \\ quote", null] as const;
const REGIONS = ['eu', 'us', 'apac', 'EU', 'US'] as const;
const START = Date.UTC(2025, 0, 1);
const END = Date.UTC(2026, 3, 15);

function utcText(milliseconds: number): string {
  return new Date(milliseconds).toISOString().replace('T', ' ').replace('Z', '');
}

export function parityOrders(count = 1500): ParityOrder[] {
  const next = random(20261026);
  const pick = <T>(values: readonly T[]) => values[Math.floor(next() * values.length)]!;
  const rows: ParityOrder[] = [];
  for (let index = 0; index < count; index++) {
    rows.push({
      tenant_id: next() < 0.9 ? 'acme' : 'other',
      customer_id: next() < 0.05 ? null : 1 + Math.floor(next() * 40),
      status: pick(STATUSES),
      region_code: pick(REGIONS),
      is_gift: next() < 0.2,
      amount_cents: Math.floor(next() * 50_000),
      // Whole seconds plus milliseconds: sub-second values must survive both engines.
      created_at: utcText(START + Math.floor(next() * (END - START))),
    });
  }
  // Rows on and around the New York DST transitions (2026-03-08 07:00Z;
  // 2025-11-02 05:00Z–07:00Z, where 01:00–02:00 local happens twice).
  for (const instant of [
    '2026-03-08 06:30:00.000', '2026-03-08 07:30:00.000', '2026-03-08 08:15:00.000', '2026-03-07 07:30:00.000',
    '2025-11-02 05:30:00.000', '2025-11-02 06:30:00.000', '2025-11-02 06:45:00.000',
  ]) {
    rows.push({ tenant_id: 'acme', customer_id: 7, status: 'paid', region_code: 'us', is_gift: false, amount_cents: 1234, created_at: instant });
  }
  // Exact bucket and range edges.
  for (const instant of ['2026-01-01 00:00:00.000', '2026-04-01 00:00:00.000', '2025-12-31 23:59:59.999']) {
    rows.push({ tenant_id: 'acme', customer_id: 3, status: 'shipped', region_code: 'eu', is_gift: true, amount_cents: 777, created_at: instant });
  }
  return rows;
}

/** Duplicated keys carry identical attributes: single-match joins may pick either row. */
export function parityCustomers(): ParityCustomer[] {
  const countries = ['DE', 'US', 'JP', 'FR', 'BR'];
  const rows: ParityCustomer[] = [];
  for (let id = 1; id <= 40; id++) {
    const row = { customer_id: id, tenant_id: 'acme', country_code: countries[id % countries.length]!, tier: id % 3 ? 'silver' : 'gold' };
    rows.push(row);
    if (id % 7 === 0) rows.push({ ...row });
  }
  rows.push({ customer_id: 1, tenant_id: 'other', country_code: 'FR', tier: 'gold' });
  return rows;
}
