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

const mockRm = vi.hoisted(() => vi.fn());
const mockLoadHypequeryConfig = vi.hoisted(() => vi.fn());
const mockLoadMigrationJournal = vi.hoisted(() => vi.fn());
const mockGetLatestTrackedMigration = vi.hoisted(() => vi.fn());
const mockRemoveTrackedMigration = vi.hoisted(() => vi.fn());
const mockWriteMigrationJournal = vi.hoisted(() => vi.fn());

vi.mock('ora', () => ({
  default: vi.fn(() => mockSpinner),
}));

vi.mock('../utils/logger.js', () => ({
  logger: mockLogger,
}));

vi.mock('node:fs/promises', () => ({
  rm: mockRm,
}));

vi.mock('../utils/load-hypequery-config.js', () => ({
  loadHypequeryConfig: mockLoadHypequeryConfig,
}));

vi.mock('../utils/migration-state.js', () => ({
  loadMigrationJournal: mockLoadMigrationJournal,
  getLatestTrackedMigration: mockGetLatestTrackedMigration,
  removeTrackedMigration: mockRemoveTrackedMigration,
  writeMigrationJournal: mockWriteMigrationJournal,
}));

describe('drop command', () => {
  let dropCommand: typeof import('./drop.js')['dropCommand'];
  let exitHandler: ReturnType<typeof mockProcessExit>;

  beforeEach(async () => {
    vi.resetModules();
    ({ dropCommand } = await import('./drop.js'));
    exitHandler = mockProcessExit();
    vi.clearAllMocks();

    mockLoadHypequeryConfig.mockResolvedValue({
      migrations: {
        out: './migrations',
      },
    });
    mockLoadMigrationJournal.mockResolvedValue({ migrations: [] });
    mockGetLatestTrackedMigration.mockReturnValue({
      name: '20260501120000_add_events',
      snapshotPath: '20260501120000_add_events_snapshot.json',
      timestamp: '20260501120000',
      kind: 'generated',
    });
    mockRemoveTrackedMigration.mockReturnValue({
      version: 1,
      latestSnapshotPath: '0000_snapshot.json',
      snapshots: [{ path: '0000_snapshot.json', source: 'baseline' }],
      migrations: [],
    });
    mockWriteMigrationJournal.mockResolvedValue('/repo/migrations/meta/_journal.json');
    mockRm.mockResolvedValue(undefined);
  });

  afterEach(() => {
    exitHandler.restore();
  });

  it('removes the latest tracked migration and updates the journal', async () => {
    await dropCommand({});

    expect(mockRm).toHaveBeenCalledWith(
      expect.stringContaining('migrations/20260501120000_add_events'),
      { recursive: true, force: true },
    );
    expect(mockRm).toHaveBeenCalledWith(
      expect.stringContaining('migrations/meta/20260501120000_add_events_snapshot.json'),
      { force: true },
    );
    expect(mockRemoveTrackedMigration).toHaveBeenCalledWith(
      expect.anything(),
      '20260501120000_add_events',
    );
    expect(mockWriteMigrationJournal).toHaveBeenCalled();
  });

  it('exits cleanly when no tracked migrations exist', async () => {
    mockGetLatestTrackedMigration.mockReturnValue(null);

    await dropCommand({});

    expect(mockSpinner.succeed).toHaveBeenCalledWith('No generated migrations to drop');
    expect(mockRm).not.toHaveBeenCalled();
    expect(mockWriteMigrationJournal).not.toHaveBeenCalled();
  });

  it('reports drop failures clearly', async () => {
    mockRm.mockRejectedValue(new Error('permission denied'));

    await expect(dropCommand({})).rejects.toBeInstanceOf(ProcessExitError);
    expect(mockLogger.error).toHaveBeenCalledWith('permission denied');
  });
});
