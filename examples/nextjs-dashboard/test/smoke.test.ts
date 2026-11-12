import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Boots the production build (`next build` has already run via `pnpm test`)
 * and checks the page and the dataset endpoint against the seed.
 */
const PORT = 3123;
const BASE = `http://127.0.0.1:${PORT}`;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let server: ChildProcess | undefined;

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('next start did not become ready');
}

beforeAll(async () => {
  server = spawn('node', [path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', String(PORT)], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(PORT) },
  });
  server.stderr?.on('data', (chunk) => process.stderr.write(chunk));
  await waitForServer();
});

afterAll(() => {
  server?.kill('SIGTERM');
});

async function query(body: Record<string, unknown>) {
  const res = await fetch(`${BASE}/api/analytics/datasets/events/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as { data?: Array<Record<string, string | null>>; error?: unknown } };
}

describe('nextjs-dashboard', () => {
  it('serves the dashboard page', async () => {
    const res = await fetch(`${BASE}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Product analytics');
  });

  it('answers the exampleRequest: events by type over the whole seed', async () => {
    const { status, json } = await query({ dimensions: ['eventType'], measures: ['events', 'uniqueUsers'] });
    expect(status).toBe(200);
    expect(json.data).toBeDefined();
    const rows = json.data!;
    expect(rows.length).toBe(6);
    for (const row of rows) {
      expect(typeof row.eventType).toBe('string');
      expect(Number(row.events)).toBeGreaterThan(0);
      expect(Number(row.uniqueUsers)).toBeGreaterThan(0);
    }
    const total = rows.reduce((sum, row) => sum + Number(row.events), 0);
    expect(total).toBe(1_000_000);
  });

  it('applies cross-filters and time grains the way the panels send them', async () => {
    const { status, json } = await query({
      by: 'day',
      measures: ['events', 'uniqueUsers'],
      filters: [
        { field: 'occurredAt', operator: 'between', value: ['2026-10-25 00:00:00', '2026-10-31 23:59:59'] },
        { field: 'eventType', operator: 'eq', value: 'api_call' },
      ],
      orderBy: [{ field: 'period', direction: 'asc' }],
    });
    expect(status).toBe(200);
    expect(json.data!.length).toBe(7);
    expect(String(json.data![0].period)).toContain('2026-10-25');
  });

  it('rejects a field the dataset does not publish', async () => {
    const { status } = await query({ dimensions: ['password'], measures: ['events'] });
    expect(status).toBe(400);
  });
});
