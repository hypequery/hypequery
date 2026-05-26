import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMigrationFilesFixture, mockProcessExit } from '../test-utils.js';
import { writeMigrationChecksumFile } from '../utils/migration-checksums.js';
import {
  appendMigrationJournalEntry,
  initializeMigrationJournal,
} from '../utils/migration-state.js';

type LoadModule = typeof import('../utils/load-api.js')['loadModule'];

vi.mock('../utils/load-api.js', () => ({
  loadModule: vi.fn(),
}));

const mockClient = vi.hoisted(() => ({
  close: vi.fn(),
}));

const mockFetchAppliedMigrationsIfTableExists = vi.hoisted(() => vi.fn());

vi.mock('../utils/clickhouse-migration-introspection.js', () => ({
  createMigrationClickHouseClient: vi.fn(() => mockClient),
}));

vi.mock('../utils/migration-remote-state.js', () => ({
  fetchAppliedMigrationsIfTableExists: mockFetchAppliedMigrationsIfTableExists,
}));

const mockLogger = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  reload: vi.fn(),
  header: vi.fn(),
  newline: vi.fn(),
  indent: vi.fn(),
  box: vi.fn(),
  table: vi.fn(),
  raw: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  logger: mockLogger,
}));

const mockSpinner = vi.hoisted(() => ({
  start: vi.fn().mockReturnThis(),
  succeed: vi.fn().mockReturnThis(),
  fail: vi.fn().mockReturnThis(),
  stop: vi.fn().mockReturnThis(),
}));

vi.mock('ora', () => ({
  default: vi.fn(() => mockSpinner),
}));

let tempDir: string;
let previousCwd: string;

describe('migrate:status command', () => {
  let exitHandler: ReturnType<typeof mockProcessExit>;
  let loadModule: ReturnType<typeof vi.mocked<LoadModule>>;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockFetchAppliedMigrationsIfTableExists.mockResolvedValue([]);

    previousCwd = process.cwd();
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'hypequery-migration-status-'));
    process.chdir(tempDir);
    exitHandler = mockProcessExit();

    ({ loadModule } = await import('../utils/load-api.js'));
    loadModule.mockResolvedValue({ default: configFixture() });
  });

  afterEach(async () => {
    exitHandler.restore();
    process.chdir(previousCwd);
    await rm(tempDir, { recursive: true, force: true });
  });

  it('shows pending local migrations with checksum status', async () => {
    await createJournaledMigration('20260525120000_add_events');
    const { migrationStatusCommand } = await import('./migration-status.js');

    await migrationStatusCommand();

    expect(mockLogger.table).toHaveBeenCalledWith(
      ['Migration', 'Type', 'State', 'Checksum', 'Remote', 'Steps'],
      [['20260525120000_add_events', 'generated', 'pending', 'ok', '-', '-']],
    );
  });

  it('shows applied remote migrations with step progress', async () => {
    const checksum = await createJournaledMigration('20260525120000_add_events');
    mockFetchAppliedMigrationsIfTableExists.mockResolvedValue([
      {
        name: '20260525120000_add_events',
        checksum,
        status: 'applied',
        appliedStepCount: 2,
        totalSteps: 2,
      },
    ]);
    const { migrationStatusCommand } = await import('./migration-status.js');

    await migrationStatusCommand();

    expect(mockLogger.table).toHaveBeenCalledWith(
      ['Migration', 'Type', 'State', 'Checksum', 'Remote', 'Steps'],
      [['20260525120000_add_events', 'generated', 'applied', 'ok', 'ok', '2/2']],
    );
  });

  it('falls back to local status when remote state is unavailable', async () => {
    await createJournaledMigration('20260525120000_add_events');
    mockFetchAppliedMigrationsIfTableExists.mockRejectedValue(new Error('connection refused'));
    const { migrationStatusCommand } = await import('./migration-status.js');

    await migrationStatusCommand();

    expect(mockLogger.table).toHaveBeenCalledWith(
      ['Migration', 'Type', 'State', 'Checksum', 'Remote', 'Steps'],
      [['20260525120000_add_events', 'generated', 'pending', 'ok', '-', '-']],
    );
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('showing local status only'));
  });

  it('reports no local migrations', async () => {
    await initializeMigrationJournal(path.join(tempDir, 'migrations'), 'snapshot-hash');
    const { migrationStatusCommand } = await import('./migration-status.js');

    await migrationStatusCommand();

    expect(mockLogger.info).toHaveBeenCalledWith('No local migrations found.');
  });
});

async function createJournaledMigration(name: string) {
  const migrationDir = await createMigrationFilesFixture(tempDir, name);
  const checksumFile = await writeMigrationChecksumFile(migrationDir);
  await initializeMigrationJournal(path.join(tempDir, 'migrations'), 'snapshot-hash');
  await appendMigrationJournalEntry(path.join(tempDir, 'migrations'), {
    name,
    timestamp: '20260525120000',
    custom: false,
    sourceSnapshotHash: 'source',
    targetSnapshotHash: 'target',
    checksum: checksumFile.checksum,
  }, 'target');
  return checksumFile.checksum;
}

function configFixture() {
  return {
    dialect: 'clickhouse',
    schema: './schema.ts',
    migrations: { out: './migrations' },
    dbCredentials: {
      host: 'localhost',
      username: 'default',
      database: 'analytics',
    },
  };
}
