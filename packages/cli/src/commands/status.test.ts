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

describe('status command', () => {
  let statusCommand: typeof import('./status.js')['statusCommand'];
  let exitHandler: ReturnType<typeof mockProcessExit>;

  beforeEach(async () => {
    vi.resetModules();
    ({ statusCommand } = await import('./status.js'));
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
      snapshots: [
        { path: '0000_snapshot.json', source: 'baseline' },
        { path: '20260501120000_add_events_snapshot.json', source: 'generated' },
      ],
      migrations: [
        {
          name: '20260501120000_add_events',
          kind: 'generated',
          snapshotPath: '20260501120000_add_events_snapshot.json',
        },
        {
          name: '20260501121000_backfill_events',
          kind: 'custom',
          snapshotPath: null,
        },
      ],
    });
    mockLoadMigrationFilesBatch.mockResolvedValue([
      {
        migrationName: '20260501120000_add_events',
        checksum: 'same-checksum',
      },
      {
        migrationName: '20260501121000_backfill_events',
        checksum: 'custom-checksum',
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

  it('renders tracked local migrations from the journal', async () => {
    await statusCommand({});

    expect(mockSpinner.succeed).toHaveBeenCalledWith('Loaded migration status');
    expect(mockLogger.kv).toHaveBeenCalledWith([
      ['directory', 'migrations'],
      ['latest', '20260501120000_add_events_snapshot.json'],
      ['snapshots', '2'],
      ['migrations', '2'],
      ['applied', '1'],
      ['pending', '1'],
      ['failed', '0'],
    ]);
    expect(mockLogger.table).toHaveBeenCalledWith(
      ['Migration', 'Kind', 'State', 'Checksum'],
      expect.arrayContaining([
        ['20260501120000_add_events', 'generated', 'applied', 'ok'],
        ['20260501121000_backfill_events', 'custom SQL', 'pending', 'unrecorded'],
      ]),
    );
    expect(mockLogger.callout).toHaveBeenCalledWith('Connected State', [
      'Local journal state and recorded ClickHouse execution state were both inspected.',
    ]);
  });

  it('reports empty local state clearly', async () => {
    mockLoadMigrationJournal.mockResolvedValue({
      latestSnapshotPath: null,
      snapshots: [],
      migrations: [],
    });

    await statusCommand({});

    expect(mockLogger.callout).toHaveBeenCalledWith('Connected State', [
      'No local migrations are currently tracked.',
      'The ClickHouse migration table is reachable, but the local journal is empty.',
    ]);
    expect(mockLogger.table).not.toHaveBeenCalled();
  });

  it('warns when applied checksums differ from local files', async () => {
    mockTryLoadAppliedMigrationStatuses.mockResolvedValue(new Map([
      ['20260501120000_add_events', {
        migration_name: '20260501120000_add_events',
        checksum: 'different-checksum',
        status: 'completed',
      }],
    ]));

    await statusCommand({});

    expect(mockLogger.callout).toHaveBeenCalledWith('Checksum Warning', [
      '1 applied migration do not match the current local files.',
      'Review the migration directory contents before applying further changes.',
    ]);
  });

  it('reports status failures clearly', async () => {
    mockLoadMigrationJournal.mockRejectedValue(new Error('bad journal'));

    await expect(statusCommand({})).rejects.toBeInstanceOf(ProcessExitError);
    expect(mockLogger.error).toHaveBeenCalledWith('bad journal');
  });
});
