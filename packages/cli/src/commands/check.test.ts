import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

vi.mock('../utils/migration-state.js', () => ({
  loadMigrationJournal: mockLoadMigrationJournal,
}));

vi.mock('../utils/migration-execution.js', () => ({
  loadMigrationFilesBatch: mockLoadMigrationFilesBatch,
  toClickHouseUrl: vi.fn(() => 'http://localhost:8123'),
  tryLoadAppliedMigrationStatuses: mockTryLoadAppliedMigrationStatuses,
}));

vi.mock('@clickhouse/client', () => ({
  createClient: mockCreateClient,
}));

describe('check command', () => {
  let checkCommand: typeof import('./check.js')['checkCommand'];
  let exitHandler: ReturnType<typeof mockProcessExit>;

  beforeEach(async () => {
    vi.resetModules();
    ({ checkCommand } = await import('./check.js'));
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
      latestSnapshotPath: '20260501120000_add_events_snapshot.json',
      snapshots: [],
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
        checksum: 'same-checksum',
      },
    ]);
    mockTryLoadAppliedMigrationStatuses.mockResolvedValue(new Map([
      ['20260501120000_add_events', {
        migration_name: '20260501120000_add_events',
        checksum: 'same-checksum',
        status: 'completed',
      }],
    ]));
    mockCreateClient.mockReturnValue({
      close: vi.fn().mockResolvedValue(undefined),
    });
  });

  afterEach(() => {
    exitHandler.restore();
  });

  it('passes when applied migrations match local files', async () => {
    await checkCommand({});

    expect(mockSpinner.succeed).toHaveBeenCalledWith('Migration check passed');
    expect(mockLogger.kv).toHaveBeenCalledWith([
      ['directory', 'migrations'],
      ['tracked', '1'],
      ['applied', '1'],
      ['failed', '0'],
      ['drift', '0'],
      ['missing', '0'],
    ]);
    expect(mockLogger.callout).toHaveBeenCalledWith('Integrity OK', [
      'Applied ClickHouse migration records match the current local files.',
    ]);
  });

  it('fails when the ClickHouse migration table is missing', async () => {
    mockTryLoadAppliedMigrationStatuses.mockResolvedValue(null);

    await expect(checkCommand({})).rejects.toBeInstanceOf(ProcessExitError);

    expect(mockSpinner.fail).toHaveBeenCalledWith('Migration check failed');
    expect(mockLogger.callout).toHaveBeenCalledWith('Missing Applied State', [
      'The ClickHouse migration table is not initialized yet.',
      'Run `hypequery migrate` before relying on execution-state integrity checks.',
    ]);
  });

  it('fails when an applied migration checksum drifts', async () => {
    mockTryLoadAppliedMigrationStatuses.mockResolvedValue(new Map([
      ['20260501120000_add_events', {
        migration_name: '20260501120000_add_events',
        checksum: 'different-checksum',
        status: 'completed',
      }],
    ]));

    await expect(checkCommand({})).rejects.toBeInstanceOf(ProcessExitError);

    expect(mockLogger.table).toHaveBeenCalledWith(
      ['Migration', 'Issue'],
      [['20260501120000_add_events', 'checksum mismatch']],
    );
    expect(mockLogger.callout).toHaveBeenCalledWith('Reconciliation Required', [
      'Recorded applied state no longer matches a clean local migration history.',
      'Resolve failed entries, restore missing files, or repair checksum drift before continuing.',
    ]);
  });

  it('fails when an applied migration is missing locally', async () => {
    mockTryLoadAppliedMigrationStatuses.mockResolvedValue(new Map([
      ['20260501130000_old_migration', {
        migration_name: '20260501130000_old_migration',
        checksum: 'same-checksum',
        status: 'completed',
      }],
    ]));

    await expect(checkCommand({})).rejects.toBeInstanceOf(ProcessExitError);

    expect(mockLogger.table).toHaveBeenCalledWith(
      ['Migration', 'Issue'],
      [['20260501130000_old_migration', 'missing local files']],
    );
  });
});
