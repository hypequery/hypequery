import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMigrationFilesFixture, mockProcessExit, ProcessExitError } from '../test-utils.js';
import { writeMigrationChecksumFile } from '../utils/migration-checksums.js';

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

describe('migrate:check command', () => {
  let exitHandler: ReturnType<typeof mockProcessExit>;
  let loadModule: ReturnType<typeof vi.mocked<LoadModule>>;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockFetchAppliedMigrationsIfTableExists.mockResolvedValue([]);

    previousCwd = process.cwd();
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'hypequery-migration-check-'));
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

  it('succeeds when all migration checksums match', async () => {
    await createMigration('20260525120000_add_events');
    const { migrationCheckCommand } = await import('./migration-check.js');

    await migrationCheckCommand();

    expect(mockLogger.success).toHaveBeenCalledWith('Verified 1 migration');
  });

  it('exits when an applied remote checksum differs', async () => {
    const { checksum } = await createMigration('20260525120000_add_events');
    mockFetchAppliedMigrationsIfTableExists.mockResolvedValue([
      {
        name: '20260525120000_add_events',
        checksum: `${checksum}-remote`,
        status: 'applied',
        appliedStepCount: 1,
        totalSteps: 1,
      },
    ]);
    const { initializeMigrationJournal, appendMigrationJournalEntry } = await import('../utils/migration-state.js');
    await initializeMigrationJournal(path.join(tempDir, 'migrations'), 'snapshot-hash');
    await appendMigrationJournalEntry(path.join(tempDir, 'migrations'), {
      name: '20260525120000_add_events',
      timestamp: '20260525120000',
      custom: false,
      sourceSnapshotHash: 'source',
      targetSnapshotHash: 'target',
      checksum,
    }, 'target');
    const { migrationCheckCommand } = await import('./migration-check.js');

    await expect(migrationCheckCommand()).rejects.toBeInstanceOf(ProcessExitError);

    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('applied checksum does not match'));
  });

  it('succeeds with local checks when remote state is unavailable', async () => {
    await createMigration('20260525120000_add_events');
    mockFetchAppliedMigrationsIfTableExists.mockRejectedValue(new Error('connection refused'));
    const { migrationCheckCommand } = await import('./migration-check.js');

    await migrationCheckCommand();

    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('checked local files only'));
    expect(mockLogger.success).toHaveBeenCalledWith('Verified 1 migration');
  });

  it('exits when a migration file changed', async () => {
    const { migrationDir } = await createMigration('20260525120000_add_events');
    await writeFile(path.join(migrationDir, 'up.sql'), 'SELECT 2;\n', 'utf8');
    const { migrationCheckCommand } = await import('./migration-check.js');

    await expect(migrationCheckCommand()).rejects.toBeInstanceOf(ProcessExitError);

    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('changed up.sql'));
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('failed integrity checks'));
  });

  it('reports no local migrations', async () => {
    const { migrationCheckCommand } = await import('./migration-check.js');

    await migrationCheckCommand();

    expect(mockLogger.info).toHaveBeenCalledWith('No local migrations found.');
  });
});

async function createMigration(name: string) {
  const migrationDir = await createMigrationFilesFixture(tempDir, name);
  const checksum = await writeMigrationChecksumFile(migrationDir);
  return { migrationDir, checksum: checksum.checksum };
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
