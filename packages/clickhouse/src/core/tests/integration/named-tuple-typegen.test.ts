import ts from 'typescript';
import { ClickHouseConnection } from '../../connection.js';
import { ensureConnectionInitialized, TEST_CONNECTION_CONFIG } from './setup';
import { SKIP_INTEGRATION_TESTS, SETUP_TIMEOUT } from './test-config.js';
import { createQueryBuilder } from '../../../index.js';
import { generateTypeDefinitions } from '../../../cli/generate-types.js';

const TABLE = 'named_tuple_typegen_test';

// The unit tests for the generator feed it hand-written type strings through a
// mocked client, so they can only prove the parser handles the spelling we
// think DESCRIBE produces. These tests assert against what the server actually
// sends, which is the part that cannot be mocked honestly.
const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS ${TABLE} (
    id UInt32,
    versions Array(Tuple(installed_version String, path Nullable(String))),
    location Tuple(region LowCardinality(String), zone Nullable(String))
  ) ENGINE = MergeTree()
  ORDER BY id
`;

interface NamedTupleSchema {
  [TABLE]: {
    id: 'UInt32';
    versions: 'Array(Tuple(installed_version String, path Nullable(String)))';
    location: 'Tuple(region LowCardinality(String), zone Nullable(String))';
  };
}

describe('Integration Tests - Named Tuple Typegen', () => {
  (SKIP_INTEGRATION_TESTS ? describe.skip : describe)('ClickHouse Integration', () => {
    let db: ReturnType<typeof createQueryBuilder<NamedTupleSchema>>;

    beforeAll(async () => {
      ensureConnectionInitialized();
      const client = ClickHouseConnection.getClient();
      await client.command({ query: `DROP TABLE IF EXISTS ${TABLE}` });
      await client.command({ query: CREATE_TABLE_SQL });

      db = createQueryBuilder<NamedTupleSchema>({
        host: TEST_CONNECTION_CONFIG.host,
        username: TEST_CONNECTION_CONFIG.user,
        password: TEST_CONNECTION_CONFIG.password,
        database: TEST_CONNECTION_CONFIG.database,
      });
    }, SETUP_TIMEOUT);

    afterAll(async () => {
      const client = ClickHouseConnection.getClient();
      await client.command({ query: `DROP TABLE IF EXISTS ${TABLE}` });
    });

    test('DESCRIBE TABLE pretty-prints named tuples across multiple lines', async () => {
      const client = ClickHouseConnection.getClient();
      const result = await client.query({
        query: `DESCRIBE TABLE ${TABLE}`,
        format: 'JSONEachRow',
      });
      const columns = await result.json<{ name: string; type: string }>();
      const versions = columns.find(column => column.name === 'versions');

      // This is the whole reason the generator stopped embedding types in
      // single-quoted literals: a raw newline in one does not parse.
      expect(versions?.type).toContain('\n');
      expect(versions?.type).toMatch(/^Array\(Tuple\(/);
      expect(versions?.type).toContain('installed_version String');
    });

    test('generates a schema file that compiles and types named tuples as objects', async () => {
      const client = ClickHouseConnection.getClient();
      const contents = await generateTypeDefinitions(client, {
        includeTables: [TABLE],
        includeUsageExample: false,
      });

      expect(contents).toContain(
        "'versions': Array<{ installed_version: string; path: string | null }>;",
      );
      expect(contents).toContain("'location': { region: string; zone: string | null };");

      const compiled = ts.transpileModule(contents, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
        reportDiagnostics: true,
      });
      const messages = (compiled.diagnostics ?? []).map(diagnostic =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
      );
      expect(messages).toEqual([]);
    });

    test('round-trips named tuples as objects rather than positional arrays', async () => {
      await db.insert(TABLE).values({
        id: 1,
        versions: [{ installed_version: '1.0.0', path: null }],
        location: { region: 'eu-west', zone: 'a' },
      }).execute();

      const [row] = await db.table(TABLE).select('*').where('id', 'eq', 1).execute();

      // The generated types claim these are objects. That holds only while the
      // server serializes named tuples as objects, so assert the shape rather
      // than trusting `output_format_json_named_tuples_as_objects` to stay on.
      expect(Array.isArray(row.versions)).toBe(true);
      expect(Array.isArray(row.versions[0])).toBe(false);
      expect(row.versions[0]).toEqual({ installed_version: '1.0.0', path: null });
      expect(Array.isArray(row.location)).toBe(false);
      expect(row.location).toEqual({ region: 'eu-west', zone: 'a' });
    });
  });
});
