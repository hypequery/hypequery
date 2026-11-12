import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../analytics/client.js';

const PORT = 3133;
const BASE = `http://127.0.0.1:${PORT}`;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let server: ChildProcess | undefined;

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${BASE}/api/demo-users`)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('server did not start');
}

async function token(email: string): Promise<{ status: number; token?: string }> {
  const res = await fetch(`${BASE}/api/analytics/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
  return { status: res.status, token: res.ok ? ((await res.json()) as { token: string }).token : undefined };
}

async function query(body: Record<string, unknown>, bearer?: string) {
  const res = await fetch(`${BASE}/api/analytics/datasets/events/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as { data?: Array<Record<string, string | null>>; error?: { code?: string; message?: string } } };
}

async function rawCount(tenantId: number): Promise<number> {
  const [row] = await db.rawQuery<{ c: string }>(`SELECT count() AS c FROM events WHERE tenant_id = ${tenantId}`);
  return Number(row.c);
}

beforeAll(async () => {
  server = spawn('node', [path.join(root, 'dist', 'src', 'index.js')], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(PORT) },
  });
  server.stderr?.on('data', (chunk) => process.stderr.write(chunk));
  await waitForServer();
});

afterAll(async () => {
  server?.kill('SIGTERM');
  await db.close();
});

describe('multi-tenant embedded analytics', () => {
  it('serves the embed page and the demo user list', async () => {
    expect((await fetch(`${BASE}/`)).status).toBe(200);
    const users = (await (await fetch(`${BASE}/api/demo-users`)).json()) as Array<{ email: string }>;
    expect(users.length).toBe(3);
    expect(users.some((u) => 'tenantId' in u)).toBe(false);
  });

  it('scopes every query to the tenant in the token (the exampleRequest)', async () => {
    const ada = (await token('ada@quartz.example')).token!;
    const grace = (await token('grace@relay.example')).token!;
    const a = await query({ measures: ['events'] }, ada);
    const g = await query({ measures: ['events'] }, grace);
    expect(a.status).toBe(200);
    expect(g.status).toBe(200);
    expect(Number(a.json.data![0].events)).toBe(await rawCount(153));
    expect(Number(g.json.data![0].events)).toBe(await rawCount(170));
    expect(a.json.data![0].events).not.toBe(g.json.data![0].events);
  });

  it('rejects requests without a token, with a bad token, and for unknown users', async () => {
    expect((await query({ measures: ['events'] })).status).toBe(401);
    expect((await query({ measures: ['events'] }, 'not-a-jwt')).status).toBe(401);
    expect((await token('mallory@nowhere.example')).status).toBe(401);
  });

  it('refuses an explicit tenant filter: the tenant comes from the token only', async () => {
    const ada = (await token('ada@quartz.example')).token!;
    const res = await query({ measures: ['events'], filters: [{ field: 'tenantId', operator: 'eq', value: 170 }] }, ada);
    expect(res.status).toBe(400);
  });

  it('answers the widget queries with per-type rows for the tenant', async () => {
    const linus = (await token('linus@helix.example')).token!;
    const res = await query({ dimensions: ['eventType'], measures: ['events'], orderBy: [{ field: 'events', direction: 'desc' }] }, linus);
    expect(res.status).toBe(200);
    const total = res.json.data!.reduce((sum, r) => sum + Number(r.events), 0);
    expect(total).toBe(await rawCount(146));
  });
});
