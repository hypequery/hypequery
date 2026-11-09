import { createQueryBuilder } from '../../../index.js';
import { ClickHouseConnection } from '../../connection.js';
import { TEST_CONNECTION_CONFIG, initializeTestConnection, setupTestDatabase } from './setup.js';
import { SKIP_INTEGRATION_TESTS, SETUP_TIMEOUT } from './test-config.js';

const PASSWORD = 'hypequery_readonly_test';
// readonly = 1 with server defaults, and readonly = 1 whose settings already ask for uncompressed Arrow.
const STRICT_USER = 'hypequery_arrow_readonly';
const PROFILED_USER = 'hypequery_arrow_readonly_profiled';
const ARROW_END_OF_STREAM = Buffer.from([0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0]);

async function readBytes(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(chunks);
    chunks.push(Buffer.from(value));
  }
}

function connectAs(username: string, options: { arrowCompression?: 'none' | 'server-default' } = {}) {
  return createQueryBuilder({
    host: TEST_CONNECTION_CONFIG.host,
    username,
    password: PASSWORD,
    database: TEST_CONNECTION_CONFIG.database,
    ...options,
  });
}

(SKIP_INTEGRATION_TESTS ? describe.skip : describe)('Arrow streams for readonly = 1 users', () => {
  const admin = () => ClickHouseConnection.getClient();

  beforeAll(async () => {
    await initializeTestConnection();
    await setupTestDatabase();
    const database = TEST_CONNECTION_CONFIG.database;
    for (const [user, settings] of [
      [STRICT_USER, 'readonly = 1'],
      [PROFILED_USER, "readonly = 1, output_format_arrow_compression_method = 'none'"],
    ] as const) {
      await admin().command({ query: `DROP USER IF EXISTS ${user}` });
      await admin().command({
        query: `CREATE USER ${user} IDENTIFIED WITH plaintext_password BY '${PASSWORD}' SETTINGS ${settings}`,
      });
      await admin().command({ query: `GRANT SELECT ON ${database}.* TO ${user}` });
    }
  }, SETUP_TIMEOUT);

  afterAll(async () => {
    for (const user of [STRICT_USER, PROFILED_USER]) {
      await admin().command({ query: `DROP USER IF EXISTS ${user}` });
    }
  });

  it('streams without default_format when the compression default is omitted', async () => {
    const db = connectAs(STRICT_USER, { arrowCompression: 'server-default' });

    const bytes = await readBytes(await db.table('test_table').select(['id', 'name']).streamArrow());

    expect(bytes.readUInt32LE(0)).toBe(0xffffffff);
    expect(bytes.subarray(-8).equals(ARROW_END_OF_STREAM)).toBe(true);
  });

  it('streams a raw statement ending in a semicolon and comment', async () => {
    const db = connectAs(STRICT_USER, { arrowCompression: 'server-default' });

    const bytes = await readBytes(await db.rawArrowStream('SELECT 1 AS x; -- export'));

    expect(bytes.subarray(-8).equals(ARROW_END_OF_STREAM)).toBe(true);
  });

  it('accepts the uncompressed default when the profile already sets it', async () => {
    const db = connectAs(PROFILED_USER);

    const bytes = await readBytes(await db.table('test_table').select(['id']).streamArrow());

    expect(bytes.subarray(-8).equals(ARROW_END_OF_STREAM)).toBe(true);
  });

  it('explains how to fix a rejected compression default', async () => {
    const db = connectAs(STRICT_USER);

    const error = await db.rawArrowStream('SELECT 1').catch((caught: unknown) => caught as Error);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("arrowCompression: 'server-default'");
    expect(error.cause).toMatchObject({ code: '164' });
  });
});
