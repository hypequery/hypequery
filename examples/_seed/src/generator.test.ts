import { describe, expect, it } from 'vitest';
import { RANGE_END, RANGE_START, SeedGenerator, TENANT_COUNT } from './generator.js';
import { utcSeconds } from './utils/format.js';

const SMALL = 20_000;

function build(count = SMALL) {
  const generator = new SeedGenerator(count);
  const events = Array.from(generator.events());
  const subscriptions = generator.subscriptionRows();
  return { generator, events, subscriptions };
}

describe('SeedGenerator', () => {
  it('produces identical rows on every run', () => {
    const a = build();
    const b = build();
    expect(a.generator.tenantRows()).toEqual(b.generator.tenantRows());
    expect(a.generator.userRows()).toEqual(b.generator.userRows());
    expect(a.events).toEqual(b.events);
    expect(a.subscriptions).toEqual(b.subscriptions);
  });

  it('pins a sample so drift in the generator is a deliberate change', () => {
    const { generator, events, subscriptions } = build();
    expect(generator.tenantRows()[0]).toMatchInlineSnapshot(`
      {
        "created_at": "2025-02-27 17:03:11",
        "industry": "devtools",
        "name": "Pulse Cloud",
        "plan": "starter",
        "region": "ap-south",
        "tenant_id": 1,
      }
    `);
    expect(events[0]).toMatchInlineSnapshot(`
      {
        "device": "api",
        "event_id": 1,
        "event_type": "api_call",
        "latency_ms": 162,
        "occurred_at": "2026-07-24 14:46:28",
        "path": "/api/v1/export",
        "status_code": 401,
        "tenant_id": 55,
        "user_id": 2565,
      }
    `);
    expect(subscriptions[0]).toMatchInlineSnapshot(`
      {
        "amount": "49.00",
        "billing_interval": "monthly",
        "currency": "USD",
        "ended_at": "2025-11-12",
        "plan": "starter",
        "started_at": "2025-03-13",
        "status": "canceled",
        "subscription_id": 1,
        "tenant_id": 1,
      }
    `);
  });

  it('keeps referential integrity and the fixed date range', () => {
    const { generator, events, subscriptions } = build();
    const tenants = generator.tenantRows();
    const users = generator.userRows();
    expect(tenants).toHaveLength(TENANT_COUNT);
    expect(users.length).toBeGreaterThan(3000);
    const tenantIds = new Set(tenants.map((t) => t.tenant_id));
    const usersById = new Map(users.map((u) => [u.user_id, u]));
    for (const user of users) expect(tenantIds.has(user.tenant_id)).toBe(true);

    const start = RANGE_START;
    const end = RANGE_END;
    for (const event of events) {
      const user = usersById.get(event.user_id);
      expect(user?.tenant_id).toBe(event.tenant_id);
      const t = Date.parse(`${event.occurred_at.replace(' ', 'T')}Z`) / 1000;
      expect(t).toBeGreaterThanOrEqual(start);
      expect(t).toBeLessThan(end);
      expect(t).toBeGreaterThanOrEqual(Date.parse(`${user!.signed_up_at.replace(' ', 'T')}Z`) / 1000);
      expect(event.latency_ms).toBeGreaterThanOrEqual(1);
    }
    for (const sub of subscriptions) {
      expect(tenantIds.has(sub.tenant_id)).toBe(true);
      if (sub.ended_at) expect(sub.ended_at >= sub.started_at).toBe(true);
    }
    expect(events.map((e) => e.event_id)).toEqual(events.map((_, i) => i + 1));
  });

  it('has the shape the wave 1 examples need', () => {
    const { events, subscriptions } = build();
    const months = new Set(events.map((e) => e.occurred_at.slice(0, 7)));
    expect(months.size).toBe(12);

    const types = new Set(events.map((e) => e.event_type));
    expect(types).toEqual(new Set(['page_view', 'api_call', 'query_run', 'login', 'export', 'error']));

    const sorted = events.map((e) => e.latency_ms).sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    expect(p95).toBeGreaterThan(p50 * 3);

    const statuses = new Set(subscriptions.map((s) => s.status));
    expect(statuses.has('active')).toBe(true);
    expect(statuses.has('canceled')).toBe(true);
    expect(subscriptions.some((s) => s.billing_interval === 'annual')).toBe(true);
    const tenantsWithTwoRows = new Set(
      subscriptions.map((s) => s.tenant_id).filter((id, i, all) => all.indexOf(id) !== i),
    );
    expect(tenantsWithTwoRows.size).toBeGreaterThan(0);

    const earliestTenant = utcSeconds(2024, 11, 1);
    expect(Date.parse(`${build().generator.tenantRows().map((t) => t.created_at).sort()[0].replace(' ', 'T')}Z`) / 1000).toBeGreaterThanOrEqual(earliestTenant);
  });
});
