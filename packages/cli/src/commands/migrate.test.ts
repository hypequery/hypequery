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

const mockLoadHypequeryConfig = vi.hoisted(() => vi.fn());
const mockLoadMigrationJournal = vi.hoisted(() => vi.fn());
const mockLoadMigrationFilesBatch = vi.hoisted(() => vi.fn());
const mockTryLoadAppliedMigrationStatuses = vi.hoisted(() => vi.fn());
const mockCreateClient = vi.hoisted(() => vi.fn());

vi.mock('ora', () => ({
  default: vi.fn(() => mockSpinner),
}));

vi.mock('../utils/logger.js', () => ({
  logger: mockLogger,
}));

vi.mock('../utils/load-hypequery-config.js', () => ({
  loadHypequeryConfig: mockLoadHypequeryConfig,
}));

vi.mock('../utils/migration-state.js', async () => {
  const actual = await vi.importActual<typeof import('../utils/migration-state.js')>('../utils/migration-state.js');
  return {
    ...actual,
    loadMigrationJournal: mockLoadMigrationJournal,
  };
});

vi.mock('../utils/migration-execution.js', async () => {
  const actual = await vi.importActual<typeof import('../utils/migration-execution.js')>('../utils/migration-execution.js');
  return {
    ...actual,
    loadMigrationFilesBatch: mockLoadMigrationFilesBatch,
    tryLoadAppliedMigrationStatuses: mockTryLoadAppliedMigrationStatuses,
  };
});

vi.mock('@clickhouse/client', () => ({
  createClient: mockCreateClient,
}));

describe('migrate command', () => {
  let migrateCommand: typeof import('./migrate.js')['migrateCommand'];
  let exitHandler: ReturnType<typeof mockProcessExit>;
  let commandMock: ReturnType<typeof vi.fn>;
  let queryMock: ReturnType<typeof vi.fn>;
  let insertMock: ReturnType<typeof vi.fn>;
  let closeMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    ({ migrateCommand } = await import('./migrate.js'));
    exitHandler = mockProcessExit();
    vi.clearAllMocks();

    mockLoadHypequeryConfig.mockResolvedValue({
      dbCredentials: {
        host: 'localhost',
        port: 8123,
        username: 'default',
        password: '',
        database: 'analytics',
      },
      migrations: {
        out: './migrations',
        table: '_hypequery_migrations',
      },
    });
    mockLoadMigrationJournal.mockResolvedValue({
      migrations: [
        {
          name: '20260501120000_add_events',
          kind: 'generated',
        },
      ],
    });
    mockLoadMigrationFilesBatch.mockResolvedValue([
      {
        migrationName: '20260501120000_add_events',
        migrationDir: '/tmp/migrations/20260501120000_add_events',
        upSql: 'CREATE TABLE `events` (`id` UInt64);',
        downSql: 'DROP TABLE `events`;',
        metaJson: '{"custom":false}',
        planJson: '{"operations":[]}',
        checksum: 'same-checksum',
        kind: 'generated',
      },
    ]);
    mockTryLoadAppliedMigrationStatuses.mockResolvedValue(new Map());

    commandMock = vi.fn().mockResolvedValue(undefined);
    queryMock = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue([]),
    });
    insertMock = vi.fn().mockResolvedValue(undefined);
    closeMock = vi.fn().mockResolvedValue(undefined);
    mockCreateClient.mockReturnValue({
      command: commandMock,
      query: queryMock,
      insert: insertMock,
      close: closeMock,
    });
  });

  afterEach(() => {
    exitHandler.restore();
  });

  it('applies pending migrations and records completion state', async () => {
    await migrateCommand({});

    expect(commandMock).toHaveBeenCalled();
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        table: '_hypequery_migrations',
        format: 'JSONEachRow',
      }),
    );
    expect(mockLogger.kv).toHaveBeenCalledWith([
      ['applied', '1'],
      ['table', '_hypequery_migrations'],
      ['database', 'analytics'],
    ]);
  });

  it('waits for mutation-backed statements to settle before marking completion', async () => {
    mockLoadMigrationFilesBatch.mockResolvedValue([
      {
        migrationName: '20260501120000_add_events',
        migrationDir: '/tmp/migrations/20260501120000_add_events',
        upSql: 'ALTER TABLE `events` MODIFY COLUMN `id` UInt128;',
        downSql: 'ALTER TABLE `events` MODIFY COLUMN `id` UInt64;',
        metaJson: '{"custom":false}',
        planJson: '{"operations":[]}',
        checksum: 'same-checksum',
        kind: 'generated',
      },
    ]);
    queryMock
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue([{ isDone: 0, latestFailReason: '' }]),
      })
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue([{ isDone: 1, latestFailReason: '' }]),
      });

    await migrateCommand({});

    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it('exits cleanly when there are no pending migrations', async () => {
    mockTryLoadAppliedMigrationStatuses.mockResolvedValue(new Map([
      ['20260501120000_add_events', {
        migration_name: '20260501120000_add_events',
        checksum: 'same-checksum',
        status: 'completed',
      }],
    ]));

    await migrateCommand({});

    expect(mockSpinner.succeed).toHaveBeenCalledWith('No pending migrations');
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('blocks when a recorded migration previously failed', async () => {
    mockTryLoadAppliedMigrationStatuses.mockResolvedValue(new Map([
      ['20260501120000_add_events', {
        migration_name: '20260501120000_add_events',
        checksum: 'same-checksum',
        status: 'failed',
      }],
    ]));

    await expect(migrateCommand({})).rejects.toBeInstanceOf(ProcessExitError);

    expect(mockSpinner.fail).toHaveBeenCalledWith('Migration state requires reconciliation');
    expect(mockLogger.callout).toHaveBeenCalledWith('Reconciliation Required', [
      '1 recorded migration previously failed in ClickHouse.',
      'Resolve the failed migration state before applying newer migrations.',
    ]);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('blocks when an applied migration checksum drifts from local files', async () => {
    mockTryLoadAppliedMigrationStatuses.mockResolvedValue(new Map([
      ['20260501120000_add_events', {
        migration_name: '20260501120000_add_events',
        checksum: 'different-checksum',
        status: 'completed',
      }],
    ]));

    await expect(migrateCommand({})).rejects.toBeInstanceOf(ProcessExitError);

    expect(mockSpinner.fail).toHaveBeenCalledWith('Migration checksum drift detected');
    expect(mockLogger.callout).toHaveBeenCalledWith('Checksum Warning', [
      '1 applied migration no longer match the local files.',
      'Restore the original files or reconcile ClickHouse before continuing.',
    ]);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('records failure state when a statement errors', async () => {
    commandMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('DDL failed'));

    await expect(migrateCommand({})).rejects.toBeInstanceOf(ProcessExitError);
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(mockLogger.callout).toHaveBeenCalledWith(
      'Reconciliation Required',
      expect.arrayContaining([
        expect.stringContaining('failed after'),
        'ClickHouse may already have partial side effects from earlier statements.',
      ]),
    );
  });

  it('records failure state when post-apply mutation verification fails', async () => {
    mockLoadMigrationFilesBatch.mockResolvedValue([
      {
        migrationName: '20260501120000_add_events',
        migrationDir: '/tmp/migrations/20260501120000_add_events',
        upSql: 'ALTER TABLE `events` MODIFY COLUMN `id` UInt128;',
        downSql: 'ALTER TABLE `events` MODIFY COLUMN `id` UInt64;',
        metaJson: '{"custom":false}',
        planJson: '{"operations":[]}',
        checksum: 'same-checksum',
        kind: 'generated',
      },
    ]);
    queryMock.mockResolvedValueOnce({
      json: vi.fn().mockResolvedValue([{ isDone: 0, latestFailReason: 'boom' }]),
    });

    await expect(migrateCommand({})).rejects.toBeInstanceOf(ProcessExitError);
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(mockLogger.callout).toHaveBeenCalledWith(
      'Reconciliation Required',
      expect.arrayContaining([
        expect.stringContaining('failed after'),
        'ClickHouse may already have partial side effects from earlier statements.',
      ]),
    );
  });
});
