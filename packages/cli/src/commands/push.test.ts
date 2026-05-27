import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  emptyMigrationSchema,
  eventsMigrationSchema,
  mockConfigAndSchemaLoader,
  mockProcessExit,
  ProcessExitError,
  writeLatestSnapshotFixture,
} from '../test-utils.js';

type LoadModule = typeof import('../utils/load-api.js')['loadModule'];

vi.mock('../utils/load-api.js', () => ({
  loadModule: vi.fn(),
}));

const mockClient = vi.hoisted(() => ({
  command: vi.fn(),
  close: vi.fn(),
}));

vi.mock('../utils/clickhouse-migration-introspection.js', () => ({
  createMigrationClickHouseClient: vi.fn(() => mockClient),
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
let loadModule: ReturnType<typeof vi.mocked<LoadModule>>;

describe('push command', () => {
  let exitHandler: ReturnType<typeof mockProcessExit>;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockClient.command.mockResolvedValue(undefined);
    mockClient.close.mockResolvedValue(undefined);

    previousCwd = process.cwd();
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'hypequery-push-'));
    process.chdir(tempDir);
    exitHandler = mockProcessExit();

    ({ loadModule } = await import('../utils/load-api.js'));
  });

  afterEach(async () => {
    exitHandler.restore();
    process.chdir(previousCwd);
    await rm(tempDir, { recursive: true, force: true });
  });

  it('applies schema diff directly and advances the latest snapshot', async () => {
    await writeLatestSnapshotFixture(tempDir, emptyMigrationSchema());
    mockConfigAndSchemaLoader(loadModule, eventsMigrationSchema());
    const { pushCommand } = await import('./push.js');

    await pushCommand();

    expect(mockClient.command).toHaveBeenCalledWith(expect.objectContaining({
      query: expect.stringContaining('CREATE TABLE `events`'),
    }));
    const latestSnapshot = JSON.parse(
      await readFile(path.join(tempDir, 'migrations', 'meta', 'latest_snapshot.json'), 'utf8'),
    );
    expect(latestSnapshot.tables).toEqual([
      expect.objectContaining({ name: 'events' }),
    ]);
    await expect(
      readFile(path.join(tempDir, 'migrations', 'meta', 'migrations.json'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('development-only'));
    expect(mockLogger.success).toHaveBeenCalledWith(expect.stringContaining('Pushed schema changes'));
  });

  it('does not apply or write when there are no schema changes', async () => {
    await writeLatestSnapshotFixture(tempDir, eventsMigrationSchema());
    mockConfigAndSchemaLoader(loadModule, eventsMigrationSchema());
    const { pushCommand } = await import('./push.js');

    await pushCommand();

    expect(mockClient.command).not.toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith('Nothing to push.');
  });

  it('does not advance the latest snapshot when direct apply fails', async () => {
    await writeLatestSnapshotFixture(tempDir, emptyMigrationSchema());
    mockConfigAndSchemaLoader(loadModule, eventsMigrationSchema());
    mockClient.command.mockRejectedValue(new Error('boom'));
    const { pushCommand } = await import('./push.js');

    await expect(pushCommand()).rejects.toBeInstanceOf(ProcessExitError);

    const latestSnapshot = JSON.parse(
      await readFile(path.join(tempDir, 'migrations', 'meta', 'latest_snapshot.json'), 'utf8'),
    );
    expect(latestSnapshot.tables).toEqual([]);
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Push failed at statement'));
  });
});
