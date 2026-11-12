import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../analytics/client.js';

const PORT = 3191;
const BASE = `http://127.0.0.1:${PORT}`;
const SINCE = '2026-10-01 00:00:00';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let server: ChildProcess | undefined;

interface Row {
  id: number; name: string; plan: string; seats: number; owner: string; renewsOn: string;
  events: number; activeUsers: number; seatUtilization: number; lastSeenAt: string | null;
}

async function accounts(query = ''): Promise<{ status: number; data: Row[] }> {
  const res = await fetch(`${BASE}/api/accounts${query}`);
  const body = (await res.json()) as { data?: Row[] };
  return { status: res.status, data: body.data ?? [] };
}

async function raw(where: string): Promise<{ events: number; users: number }> {
  const [row] = await db.rawQuery<{ events: string; users: string }>(
    `SELECT count() AS events, uniqExact(user_id) AS users FROM events WHERE occurred_at >= '${SINCE}' AND ${where}`,
  );
  return { events: Number(row.events), users: Number(row.users) };
}

beforeAll(async () => {
  // No DATABASE_URL: the server boots PGlite in-process and seeds it.
  const env = { ...process.env, PORT: String(PORT) };
  delete env.DATABASE_URL;
  server = spawn('node', [path.join(root, 'dist', 'src', 'index.js')], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env });
  server.stderr?.on('data', (chunk) => process.stderr.write(chunk));
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${BASE}/`)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('server did not start');
});

afterAll(async () => {
  server?.kill('SIGTERM');
  await db.close();
});

describe('postgres app + clickhouse analytics', () => {
  it('returns Postgres accounts enriched with ClickHouse usage (the exampleRequest)', async () => {
    const { status, data } = await accounts('?plan=enterprise');
    expect(status).toBe(200);
    expect(data).toHaveLength(22);
    for (const row of data) {
      expect(Object.keys(row).sort()).toEqual(
        ['activeUsers', 'events', 'id', 'lastSeenAt', 'name', 'owner', 'plan', 'renewsOn', 'seatUtilization', 'seats'],
      );
      expect(row.plan).toBe('enterprise');
      expect(row.renewsOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof row.events).toBe('number');
      expect(row.seatUtilization).toBe(Math.round((row.activeUsers / row.seats) * 100) / 100);
    }
  });

  it('joins on the right id: per-account usage equals raw ClickHouse SQL', async () => {
    const { data } = await accounts('?plan=enterprise');
    const quartz = data.find((a) => a.id === 153)!;
    expect(quartz.name).toBe('Quartz Metrics');
    const truth = await raw('tenant_id = 153');
    expect(quartz.events).toBe(truth.events);
    expect(quartz.activeUsers).toBe(truth.users);
  });

  it('covers every account, including ones with no usage in the window', async () => {
    const { data } = await accounts();
    expect(data).toHaveLength(200);
    expect(data.reduce((sum, a) => sum + a.events, 0)).toBe((await raw('1 = 1')).events);
    for (const idle of data.filter((a) => a.events === 0)) {
      expect(idle.activeUsers).toBe(0);
      expect(idle.lastSeenAt).toBeNull();
    }
  });

  it('rejects a malformed since parameter', async () => {
    expect((await accounts('?since=yesterday')).status).toBe(400);
  });
});
