import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockProcessExit, ProcessExitError } from '../test-utils.js';

type LoadModule = typeof import('../utils/load-api.js')['loadModule'];

vi.mock('../utils/load-api.js', () => ({
  loadModule: vi.fn(),
}));

const mockApplyPendingMigrations = vi.hoisted(() => vi.fn());

vi.mock('../utils/migration-execution.js', () => ({
  applyPendingMigrations: mockApplyPendingMigrations,
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

describe('migrate:deploy command', () => {
  let exitHandler: ReturnType<typeof mockProcessExit>;
  let loadModule: ReturnType<typeof vi.mocked<LoadModule>>;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    previousCwd = process.cwd();
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'hypequery-migration-deploy-'));
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

  it('applies pending migrations', async () => {
    mockApplyPendingMigrations.mockResolvedValue([
      {
        name: '20260525120000_add_events',
        state: 'applied',
        appliedStepCount: 1,
        totalSteps: 1,
      },
    ]);
    const { migrationDeployCommand } = await import('./migration-deploy.js');

    await migrationDeployCommand();

    expect(mockApplyPendingMigrations).toHaveBeenCalledWith(expect.objectContaining({
      migrationsOutDir: expect.stringMatching(/hypequery-migration-deploy-.+\/migrations$/),
      migrationTable: '_hypequery_migrations',
    }));
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Distributed migration locking'));
    expect(mockLogger.success).toHaveBeenCalledWith('Applied 1 migration.');
  });

  it('exits when apply fails', async () => {
    mockApplyPendingMigrations.mockRejectedValue(new Error('apply failed'));
    const { migrationDeployCommand } = await import('./migration-deploy.js');

    await expect(migrationDeployCommand()).rejects.toBeInstanceOf(ProcessExitError);

    expect(mockLogger.error).toHaveBeenCalledWith('apply failed');
  });
});

function configFixture() {
  return {
    dialect: 'clickhouse',
    schema: './schema.ts',
    migrations: {
      out: './migrations',
      table: '_hypequery_migrations',
    },
    dbCredentials: {
      host: 'localhost',
      username: 'default',
      database: 'analytics',
    },
  };
}
