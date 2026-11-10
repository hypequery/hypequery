import type { AddressInfo } from 'node:net';
import { serve, type ServerType } from '@hono/node-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { db } from '../analytics/client.js';

const KEY = process.env.API_KEY ?? 'demo-key-change-me';
let server: ServerType;
let base = '';

beforeAll(async () => {
  // Port 0: the OS picks a free port, so parallel runs never collide.
  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, (info: AddressInfo) => {
      base = `http://127.0.0.1:${info.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.close();
});

const get = (path: string, key: string | null = KEY) =>
  fetch(`${base}${path}`, { headers: key ? { authorization: `Bearer ${key}` } : {} });

async function raw<T>(sql: string): Promise<T[]> {
  return db.rawQuery<T>(sql);
}

describe('ClickHouse REST API', () => {
  it('returns daily active users that match raw SQL (the exampleRequest)', async () => {
    const res = await get('/api/metrics/daily-active-users?from=2026-10-01&to=2026-10-07');
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ day: string; activeUsers: number }>;
    expect(rows).toHaveLength(7);
    expect(rows[0]).toEqual({ day: '2026-10-01', activeUsers: expect.any(Number) });
    const [truth] = await raw<{ c: string }>(
      "SELECT uniqExact(user_id) AS c FROM events WHERE toDate(occurred_at) = '2026-10-01'",
    );
    expect(rows[0].activeUsers).toBe(Number(truth.c));
  });

  it('returns usage for one tenant and 404s an unknown one', async () => {
    const res = await get('/api/tenants/usage?tenantId=153&from=2026-10-01&to=2026-10-31');
    expect(res.status).toBe(200);
    const usage = (await res.json()) as Record<string, unknown>;
    expect(usage).toMatchObject({ tenantId: 153, name: expect.any(String), plan: expect.any(String) });
    for (const field of ['events', 'activeUsers', 'errors', 'p95LatencyMs']) expect(typeof usage[field]).toBe('number');
    const [truth] = await raw<{ c: string }>(
      "SELECT count() AS c FROM events WHERE tenant_id = 153 AND occurred_at BETWEEN '2026-10-01 00:00:00' AND '2026-10-31 23:59:59'",
    );
    expect(usage.events).toBe(Number(truth.c));
    expect((await get('/api/tenants/usage?tenantId=999999')).status).toBe(404);
  });

  it('validates input before it reaches ClickHouse', async () => {
    expect((await get('/api/metrics/top-paths?limit=500')).status).toBe(400);
    expect((await get('/api/tenants/usage?tenantId=abc')).status).toBe(400);
    const top = (await (await get('/api/metrics/top-paths?limit=3')).json()) as unknown[];
    expect(top).toHaveLength(3);
  });

  it('rejects missing and wrong API keys', async () => {
    expect((await get('/api/metrics/daily-active-users', null)).status).toBe(401);
    expect((await get('/api/metrics/daily-active-users', 'wrong-key')).status).toBe(401);
    // Names inherited by every plain object must not pass as keys.
    expect((await get('/api/metrics/daily-active-users', 'constructor')).status).toBe(401);
    expect((await get('/api/metrics/daily-active-users', '__proto__')).status).toBe(401);
  });

  it('publishes an OpenAPI document listing every endpoint with its parameters', async () => {
    const res = await get('/openapi.json', null);
    expect(res.status).toBe(200);
    const spec = (await res.json()) as {
      openapi: string;
      paths: Record<string, { get?: { parameters?: Array<{ name: string; schema: Record<string, unknown> }>; security?: unknown[] } }>;
      components?: { securitySchemes?: Record<string, unknown> };
    };
    expect(spec.openapi).toMatch(/^3\./);
    const params = (path: string) => spec.paths[path]?.get?.parameters?.map((p) => p.name).sort();
    expect(params('/api/metrics/daily-active-users')).toEqual(['from', 'to']);
    expect(params('/api/tenants/usage')).toEqual(['from', 'tenantId', 'to']);
    expect(params('/api/metrics/top-paths')).toEqual(['from', 'limit', 'to']);
    const limit = spec.paths['/api/metrics/top-paths'].get!.parameters!.find((p) => p.name === 'limit')!;
    expect(limit.schema).toMatchObject({ type: 'integer', maximum: 50 });
    expect(spec.paths['/api/tenants/usage'].get!.security).toBeDefined();
    expect(spec.components?.securitySchemes).toHaveProperty('ApiKeyAuth');
  });

  it('serves interactive docs without a key', async () => {
    const res = await get('/docs', null);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('/openapi.json');
  });
});
