import { randomUUID } from 'node:crypto';
import { createClient } from '@clickhouse/client';
import { createQueryBuilder } from '../../../index.js';
import { initializeTestConnection } from './setup.js';
import { TEST_CONNECTION_CONFIG } from '../../../../../../testing/clickhouse/harness.mjs';

// Import centralized test configuration
import { SKIP_INTEGRATION_TESTS, SETUP_TIMEOUT } from './test-config.js';

/** Long enough to still be running when it is aborted, on any CI machine. */
const SLOW_QUERY =
  'SELECT count() FROM (SELECT number FROM system.numbers LIMIT 100000000000) '
  + 'WHERE sipHash64(number) % 7 = 3';

const READONLY_USER = 'hypequery_cancel_readonly';
const READONLY_PASSWORD = 'hypequery_cancel_readonly';

function connection(overrides: Record<string, unknown> = {}) {
  return createQueryBuilder<any>({
    url: TEST_CONNECTION_CONFIG.host,
    username: TEST_CONNECTION_CONFIG.user,
    password: TEST_CONNECTION_CONFIG.password,
    database: TEST_CONNECTION_CONFIG.database,
    ...overrides,
  });
}

(SKIP_INTEGRATION_TESTS ? describe.skip : describe)('Server-side cancellation', () => {
  let admin: ReturnType<typeof connection>;
  /** DDL goes through the raw client: `rawQuery` appends a result format. */
  const ddl = createClient({
    url: TEST_CONNECTION_CONFIG.host,
    username: TEST_CONNECTION_CONFIG.user,
    password: TEST_CONNECTION_CONFIG.password,
  });

  async function running(queryId: string): Promise<number> {
    const rows = await admin.rawQuery<{ running: string | number }>(
      `SELECT count() AS running FROM system.processes WHERE query_id = '${queryId}'`,
    );
    return Number(rows[0]?.running ?? 0);
  }

  async function waitFor(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await check()) return true;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return check();
  }

  /** Starts SLOW_QUERY, waits until ClickHouse is running it, then aborts. */
  async function abortWhileRunning(db: ReturnType<typeof connection>) {
    const queryId = randomUUID();
    const controller = new AbortController();
    const pending = db
      .rawQuery(SLOW_QUERY, [], { abortSignal: controller.signal, queryId })
      .then(() => 'resolved', () => 'rejected');

    const started = await waitFor(async () => (await running(queryId)) > 0, 10_000);
    expect(started).toBe(true);
    controller.abort(new Error('client gave up'));
    await expect(pending).resolves.toBe('rejected');
    return queryId;
  }

  beforeAll(async () => {
    await initializeTestConnection();
    admin = connection();
    await ddl.command({ query: `DROP USER IF EXISTS ${READONLY_USER}` });
    await ddl.command({
      query: `CREATE USER ${READONLY_USER} IDENTIFIED WITH plaintext_password BY '${READONLY_PASSWORD}' `
        + 'SETTINGS readonly = 1',
    });
    await ddl.command({ query: `GRANT SELECT ON system.one TO ${READONLY_USER}` });
  }, SETUP_TIMEOUT);

  afterAll(async () => {
    await ddl.command({ query: `DROP USER IF EXISTS ${READONLY_USER}` });
    await ddl.close();
  });

  it('stops an aborted query on the server when the connection is read-only', async () => {
    const db = connection({ clickhouse_settings: { readonly: '2' } });

    const queryId = await abortWhileRunning(db);

    const stopped = await waitFor(async () => (await running(queryId)) === 0, 2_000);
    expect(stopped).toBe(true);
  }, 30_000);

  // A `readonly = 1` user refuses every per-query setting. Before server-side
  // cancellation existed, an abortable query on such a connection worked; it
  // must keep working.
  it('keeps abortable queries working on a readonly = 1 connection', async () => {
    const db = connection({
      username: READONLY_USER,
      password: READONLY_PASSWORD,
      database: 'system',
      integerJsonEncoding: 'server-default',
    });
    const signal = new AbortController().signal;

    await expect(db.rawQuery('SELECT 1 AS one', [], { abortSignal: signal }))
      .resolves.toEqual([{ one: 1 }]);
    await expect(db.rawQuery('SELECT 2 AS two', [], { abortSignal: signal }))
      .resolves.toEqual([{ two: 2 }]);
  }, 30_000);
});
