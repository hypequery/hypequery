import type { AddressInfo } from 'node:net';
import { serve, type ServerType } from '@hono/node-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../analytics/client.js';
import { PLANS } from '../analytics/pricing.js';
import { format, times } from '../analytics/utils/money.js';
import { app } from '../src/app.js';

let server: ServerType;
let base = '';

beforeAll(async () => {
  // Port 0: the OS picks a free port, so parallel runs never collide.
  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, (info: AddressInfo) => {
      base = `http://127.0.0.1:${info.port}/api/billing`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.close();
});

async function get(path: string, key?: string) {
  const res = await fetch(`${base}${path}`, { headers: key ? { authorization: `Bearer ${key}` } : {} });
  return { status: res.status, json: (await res.json()) as any };
}

/** The same invoice computed entirely in ClickHouse, with Decimal arithmetic, as ground truth. */
async function rawInvoiceTotal(tenantId: number, start: string, end: string): Promise<string> {
  const [sub] = await db.rawQuery<{ plan: string; billing_interval: string; status: string; amount: string; started_at: string }>(`
    SELECT plan, billing_interval, status, toString(amount) AS amount, toString(started_at) AS started_at
    FROM subscriptions
    WHERE tenant_id = ${tenantId} AND started_at < '${end}' AND ifNull(ended_at, toDate('2100-01-01')) > '${start}'
    ORDER BY started_at DESC LIMIT 1`);
  const p = PLANS[sub.plan];
  const baseDue = sub.status !== 'trialing' && (sub.billing_interval === 'monthly' || sub.started_at.slice(5, 7) === start.slice(5, 7));
  const [row] = await db.rawQuery<{ total: string }>(`
    WITH
      (SELECT countIf(event_type = 'api_call') FROM events WHERE tenant_id = ${tenantId} AND occurred_at >= '${start}' AND occurred_at < '${end}') AS api,
      (SELECT countIf(event_type = 'query_run') FROM events WHERE tenant_id = ${tenantId} AND occurred_at >= '${start}' AND occurred_at < '${end}') AS qr
    SELECT toString(
        toDecimal64('${baseDue ? sub.amount : '0'}', 4)
      + round(toDecimal64(greatest(toInt64(api) - ${p.apiCalls.included}, 0), 0) * toDecimal64('${p.apiCalls.overageUnitPrice}', 4), 2)
      + round(toDecimal64(greatest(toInt64(qr) - ${p.queryRuns.included}, 0), 0) * toDecimal64('${p.queryRuns.overageUnitPrice}', 4), 2)
    ) AS total`);
  return format(times(row.total, 1));
}

describe('usage-based billing', () => {
  it('returns the invoice preview for the signed-in tenant (the exampleRequest)', async () => {
    const { status, json } = await get('/invoice-preview?period=2026-09', 'demo-relay-works');
    expect(status).toBe(200);
    // Pinned against the deterministic seed: tenant 170 (Relay Works), September 2026.
    expect(json).toEqual({
      tenantId: '170',
      period: '2026-09',
      periodStart: '2026-09-01',
      periodEnd: '2026-10-01',
      usage: { apiCalls: 321, queryRuns: 187 },
      plan: 'growth',
      currency: 'USD',
      lines: [
        { description: 'growth plan (monthly)', quantity: 1, unitPrice: '199.00', amount: '199.00' },
        { description: 'API calls over 150 included (321 used)', quantity: 171, unitPrice: '0.025', amount: '4.28' },
        { description: 'Query runs over 100 included (187 used)', quantity: 87, unitPrice: '0.05', amount: '4.35' },
      ],
      total: '207.63',
    });
  });

  it('reconciles invoice totals with raw ClickHouse SQL across tenants, plans and periods', async () => {
    const cases: Array<[string, number, string, string, string]> = [
      ['demo-relay-works', 170, '2026-09', '2026-09-01', '2026-10-01'],
      ['demo-relay-works', 170, '2026-08', '2026-08-01', '2026-09-01'],
      ['demo-quartz-metrics', 153, '2026-10', '2026-10-01', '2026-11-01'], // upgraded to enterprise mid-month
      ['demo-helix-analytics', 146, '2026-10', '2026-10-01', '2026-11-01'],
    ];
    for (const [key, tenantId, period, start, end] of cases) {
      const { json } = await get(`/invoice-preview?period=${period}`, key);
      expect(json.total, `${tenantId} ${period}`).toBe(await rawInvoiceTotal(tenantId, start, end));
    }
  });

  it('serves the usage widget from the same numbers as the invoice', async () => {
    const usage = await get('/usage?period=2026-10', 'demo-quartz-metrics');
    const invoice = await get('/invoice-preview?period=2026-10', 'demo-quartz-metrics');
    expect(usage.status).toBe(200);
    expect(usage.json).toEqual({
      period: '2026-10',
      plan: 'enterprise',
      meters: [
        { meter: 'apiCalls', used: invoice.json.usage.apiCalls, included: 2000 },
        { meter: 'queryRuns', used: invoice.json.usage.queryRuns, included: 1000 },
      ],
      projectedTotal: invoice.json.total,
      currency: 'EUR',
    });
  });

  it('is tenant-scoped and fails closed', async () => {
    expect((await get('/invoice-preview?period=2026-09')).status).toBe(401);
    expect((await get('/invoice-preview?period=2026-09', 'not-a-key')).status).toBe(401);
    expect((await get('/invoice-preview?period=2026-09', 'demo-finance')).status).toBe(403); // no tenant
    const res = await fetch(`${base}/datasets/usage/query`, {
      method: 'POST',
      headers: { authorization: 'Bearer demo-relay-works', 'content-type': 'application/json' },
      body: JSON.stringify({ measures: ['apiCalls'], filters: [{ field: 'tenantId', operator: 'eq', value: 153 }] }),
    });
    expect(res.status).toBe(400);
  });

  it('reports MRR per currency, point in time, for the billing role only', async () => {
    expect((await get('/mrr?through=2026-10', 'demo-relay-works')).status).toBe(403);
    const { status, json } = await get('/mrr?through=2026-10', 'demo-finance');
    expect(status).toBe(200);
    expect(new Set(json.map((r: { month: string }) => r.month)).size).toBe(12);
    const raw = await db.rawQuery<{ currency: string; mrr: string; subs: string }>(`
      SELECT currency,
             toString(sum(if(billing_interval = 'annual', toDecimal64(amount, 4) / 12, toDecimal64(amount, 4)))) AS mrr,
             count() AS subs
      FROM subscriptions
      WHERE status != 'trialing' AND started_at <= '2026-10-01' AND ifNull(ended_at, toDate('2100-01-01')) > '2026-10-01'
      GROUP BY currency ORDER BY currency`);
    const october = json.filter((r: { month: string }) => r.month === '2026-10-01');
    expect(october).toEqual(raw.map((r) => ({ month: '2026-10-01', currency: r.currency, mrr: format(times(r.mrr, 1)), subscriptions: Number(r.subs) })));
  });
});

describe('money', () => {
  it('multiplies and rounds without floats', () => {
    expect(format(times('0.0125', 2410))).toBe('30.13'); // 30.125, half away from zero
    expect(format(times('0.025', 171))).toBe('4.28'); // 4.275
    expect(format(times('0.1', 3))).toBe('0.30'); // 0.1 * 3 is 0.30000000000000004 as a float
    expect(format(times('-0.005', 1))).toBe('-0.01');
  });
});
