import { afterAll, describe, expect, it } from 'vitest';
import { db } from '../analytics/client.js';
import { RANGE, runTranscript } from '../src/agent.js';

async function rawCount(tenantId: number): Promise<number> {
  const [row] = await db.rawQuery<{ c: string }>(
    `SELECT count() AS c FROM events WHERE tenant_id = ${tenantId} AND occurred_at BETWEEN '${RANGE[0]}' AND '${RANGE[1]}'`,
  );
  return Number(row.c);
}

afterAll(async () => {
  await db.close();
});

describe('governed MCP server', () => {
  it('exposes the four governed tools and only the published datasets', async () => {
    const t = await runTranscript('153');
    expect(t.tools).toEqual(['get_dataset_schema', 'list_datasets', 'query_dataset', 'query_metric']);
    const names = JSON.stringify(t.datasets);
    expect(names).toContain('events');
    expect(names).toContain('subscriptions');
    expect(names).not.toContain('tenants');
    expect(t.eventsSchemaMeasures).toEqual(['errorRate', 'errors', 'events', 'p95LatencyMs', 'uniqueUsers']);
  });

  it('scopes every query to the tenant the server was started for (the exampleRequest)', async () => {
    const a = await runTranscript('153');
    const b = await runTranscript('170');
    const sum = (t: typeof a) => ((t.eventsByType as { data: Array<{ events: string }> }).data).reduce((s, r) => s + Number(r.events), 0);
    expect(sum(a)).toBe(await rawCount(153));
    expect(sum(b)).toBe(await rawCount(170));
    expect(sum(a)).not.toBe(sum(b));
    expect((a.eventsByType as { data: unknown[] }).data.length).toBe(6);
  });

  it('refuses an agent that tries to choose the tenant, and never returns SQL', async () => {
    const t = await runTranscript('153');
    expect(t.tenantFilterRefused.ok).toBe(true);
    expect(JSON.stringify(t)).not.toMatch(/SELECT\s+[\s\S]*FROM\s+events/i);
  });
});
