import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProcessExitError, mockProcessExit } from '../test-utils.js';

const mockLogger = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  reload: vi.fn(),
  phase: vi.fn(),
  header: vi.fn(),
  command: vi.fn(),
  newline: vi.fn(),
  indent: vi.fn(),
  box: vi.fn(),
  callout: vi.fn(),
  table: vi.fn(),
  kv: vi.fn(),
  raw: vi.fn(),
}));

const mockSpinner = vi.hoisted(() => ({
  text: '',
  start: vi.fn().mockReturnThis(),
  succeed: vi.fn().mockReturnThis(),
  fail: vi.fn().mockReturnThis(),
  stop: vi.fn().mockReturnThis(),
}));

const mockReaddir = vi.hoisted(() => vi.fn());
const mockReadFile = vi.hoisted(() => vi.fn());
const mockWriteFile = vi.hoisted(() => vi.fn());
const mockMkdir = vi.hoisted(() => vi.fn());
const mockLoadHypequeryConfig = vi.hoisted(() => vi.fn());
const mockLoadModule = vi.hoisted(() => vi.fn());
const mockDefineSchema = vi.hoisted(() => vi.fn((definition) => ({ tables: definition.tables, materializedViews: [] })));
const mockSerializeSchemaToSnapshot = vi.hoisted(() => vi.fn());
const mockDiffSnapshots = vi.hoisted(() => vi.fn());
const mockRenderMigrationArtifacts = vi.hoisted(() => vi.fn());
const mockWriteMigrationArtifacts = vi.hoisted(() => vi.fn());

vi.mock('ora', () => ({
  default: vi.fn(() => mockSpinner),
}));

vi.mock('../utils/logger.js', () => ({
  logger: mockLogger,
}));

vi.mock('node:fs/promises', () => ({
  readdir: mockReaddir,
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
}));

vi.mock('../utils/load-hypequery-config.js', () => ({
  DEFAULT_HYPEQUERY_CONFIG_PATH: 'hypequery.config.ts',
  loadHypequeryConfig: mockLoadHypequeryConfig,
}));

vi.mock('../utils/load-api.js', () => ({
  loadModule: mockLoadModule,
}));

vi.mock('@hypequery/clickhouse', () => ({
  defineSchema: mockDefineSchema,
  diffSnapshots: mockDiffSnapshots,
  renderMigrationArtifacts: mockRenderMigrationArtifacts,
  serializeSchemaToSnapshot: mockSerializeSchemaToSnapshot,
  snapshotToStableJson: vi.fn((snapshot) => JSON.stringify(snapshot, null, 2)),
  writeMigrationArtifacts: mockWriteMigrationArtifacts,
}));

describe('generate migration command', () => {
  let generateMigrationCommand: typeof import('./generate-migration.js')['generateMigrationCommand'];
  let exitHandler: ReturnType<typeof mockProcessExit>;

  beforeEach(async () => {
    vi.resetModules();
    ({ generateMigrationCommand } = await import('./generate-migration.js'));
    exitHandler = mockProcessExit();
    vi.clearAllMocks();

    mockLoadHypequeryConfig.mockResolvedValue({
      dialect: 'clickhouse',
      schema: './src/schema.ts',
      dbCredentials: {
        host: 'localhost',
        username: 'default',
        database: 'analytics',
      },
      migrations: {
        out: './migrations',
        table: '_hypequery_migrations',
        prefix: 'timestamp',
      },
    });

    mockLoadModule.mockResolvedValue({
      schema: { tables: [{ name: 'events' }], materializedViews: [] },
    });

    mockReaddir.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    mockReadFile.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockSerializeSchemaToSnapshot
      .mockReturnValueOnce({ contentHash: 'next-hash', tables: [{ name: 'events' }] })
      .mockReturnValue({ contentHash: 'empty-hash', tables: [] });
    mockDiffSnapshots.mockReturnValue({ operations: [] });
    mockRenderMigrationArtifacts.mockReturnValue({
      upSql: 'CREATE TABLE `events` ();',
      downSql: 'DROP TABLE `events`;',
      meta: { name: 'meta', timestamp: 'ts', operations: [], custom: false, unsafe: false, containsManualSteps: false },
      plan: { operations: [] },
    });
    mockWriteMigrationArtifacts.mockResolvedValue({
      migrationDir: '/repo/migrations/20260501120000_add_events',
      upPath: '/repo/migrations/20260501120000_add_events/up.sql',
      downPath: '/repo/migrations/20260501120000_add_events/down.sql',
      metaPath: '/repo/migrations/20260501120000_add_events/meta.json',
      planPath: '/repo/migrations/20260501120000_add_events/plan.json',
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-01T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    exitHandler.restore();
  });

  it('writes a migration and snapshot when schema changes exist', async () => {
    await generateMigrationCommand({ name: 'Add events' });

    expect(mockLoadHypequeryConfig).toHaveBeenCalledWith('hypequery.config.ts');
    expect(mockLoadModule).toHaveBeenCalledWith('./src/schema.ts');
    expect(mockDiffSnapshots).toHaveBeenCalled();
    expect(mockRenderMigrationArtifacts).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: '20260501120000_add_events',
        timestamp: '20260501120000',
      }),
    );
    expect(mockWriteMigrationArtifacts).toHaveBeenCalledWith(
      expect.objectContaining({
        migrationName: '20260501120000_add_events',
      }),
    );
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('migrations/meta/20260501120000_add_events_snapshot.json'),
      expect.stringContaining('"contentHash": "next-hash"'),
      'utf8',
    );
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('migrations/meta/_journal.json'),
      expect.stringContaining('"latestSnapshotPath": "20260501120000_add_events_snapshot.json"'),
      'utf8',
    );
  });

  it('writes a custom migration scaffold without advancing the snapshot', async () => {
    await generateMigrationCommand({ name: 'Backfill events', custom: true });

    expect(mockWriteMigrationArtifacts).not.toHaveBeenCalled();
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('20260501120000_backfill_events/up.sql'),
      expect.stringContaining('Custom migrations bypass automatic schema diffing'),
      'utf8',
    );
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('20260501120000_backfill_events/meta.json'),
      expect.stringContaining('"custom": true'),
      'utf8',
    );
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('migrations/meta/_journal.json'),
      expect.stringContaining('"kind": "custom"'),
      'utf8',
    );
  });

  it('uses the journal latest snapshot when one exists', async () => {
    mockReadFile.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith('_journal.json')) {
        return JSON.stringify({
          version: 1,
          latestSnapshotPath: '20260430115959_previous_snapshot.json',
          snapshots: [{ path: '20260430115959_previous_snapshot.json', source: 'generated' }],
          migrations: [],
        });
      }

      return JSON.stringify({ contentHash: 'previous-hash', tables: [{ name: 'old_events' }] });
    });

    await generateMigrationCommand({ name: 'Add events' });

    expect(mockReadFile).toHaveBeenCalledWith(
      expect.stringContaining('_journal.json'),
      'utf8',
    );
    expect(mockReadFile).toHaveBeenCalledWith(
      expect.stringContaining('20260430115959_previous_snapshot.json'),
      'utf8',
    );
    expect(mockDiffSnapshots).toHaveBeenCalledWith(
      expect.objectContaining({ contentHash: 'previous-hash' }),
      expect.objectContaining({ contentHash: expect.any(String) }),
    );
  });

  it('falls back to legacy snapshot discovery when the journal does not exist', async () => {
    mockReaddir.mockResolvedValue([
      '0000_snapshot.json',
      '20260430115959_previous_snapshot.json',
    ]);
    mockReadFile.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith('_journal.json')) {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      }

      return JSON.stringify({ contentHash: 'previous-hash', tables: [{ name: 'old_events' }] });
    });

    await generateMigrationCommand({ name: 'Add events' });

    expect(mockReaddir).toHaveBeenCalled();
    expect(mockDiffSnapshots).toHaveBeenCalledWith(
      expect.objectContaining({ contentHash: 'previous-hash' }),
      expect.objectContaining({ contentHash: expect.any(String) }),
    );
  });

  it('does not write a migration when the schema snapshot has not changed', async () => {
    mockSerializeSchemaToSnapshot.mockReset();
    mockSerializeSchemaToSnapshot.mockReturnValue({ contentHash: 'same-hash', tables: [] });
    mockReaddir.mockResolvedValue(['20260430115959_previous_snapshot.json']);
    mockReadFile.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith('_journal.json')) {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      }

      return JSON.stringify({ contentHash: 'same-hash', tables: [] });
    });

    await generateMigrationCommand({ name: 'Noop' });

    expect(mockSpinner.succeed).toHaveBeenCalledWith('Schema is already up to date');
    expect(mockWriteMigrationArtifacts).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('fails clearly when the schema module export is invalid', async () => {
    mockLoadModule.mockResolvedValue({ default: { notSchema: true } });

    await expect(generateMigrationCommand({ name: 'Broken schema' })).rejects.toBeInstanceOf(ProcessExitError);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Invalid schema module: ./src/schema.ts'),
    );
  });
});
