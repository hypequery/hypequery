import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Snapshot } from '@hypequery/schema';
import { mockProcessExit, ProcessExitError } from '../test-utils.js';

type LoadModule = typeof import('../utils/load-api.js')['loadModule'];

vi.mock('../utils/load-api.js', () => ({
  loadModule: vi.fn(),
}));

const mockSnapshot = vi.hoisted((): Snapshot => ({
  version: 1,
  dialect: 'clickhouse',
  contentHash: 'snapshot-hash',
  dependencies: [],
  materializedViews: [],
  tables: [
    {
      name: 'events',
      columns: [{ name: 'id', type: 'UUID' }],
      engine: {
        type: 'MergeTree',
        orderBy: ['id'],
        primaryKey: [],
      },
      settings: {},
    },
  ],
}));

const introspectClickHouseSchema = vi.hoisted(() => vi.fn(async () => mockSnapshot));

vi.mock('../utils/clickhouse-migration-introspection.js', () => ({
  introspectClickHouseSchema,
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

describe('pull command', () => {
  let tempDir: string;
  let previousCwd: string;
  let exitHandler: ReturnType<typeof mockProcessExit>;
  let loadModule: ReturnType<typeof vi.mocked<LoadModule>>;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'hypequery-pull-'));
    previousCwd = process.cwd();
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

  it('writes a baseline schema, latest snapshot, and empty migration journal', async () => {
    const { pullCommand } = await import('./pull.js');

    await pullCommand();

    const schema = await readFile(path.join(tempDir, 'schema.ts'), 'utf8');
    const latestSnapshot = JSON.parse(
      await readFile(path.join(tempDir, 'migrations', 'meta', 'latest_snapshot.json'), 'utf8'),
    );
    const journal = JSON.parse(
      await readFile(path.join(tempDir, 'migrations', 'meta', 'migrations.json'), 'utf8'),
    );

    expect(schema).toContain('defineTable("events"');
    expect(latestSnapshot).toMatchObject({ contentHash: 'snapshot-hash' });
    expect(journal).toEqual({
      version: 1,
      dialect: 'clickhouse',
      latestSnapshotHash: 'snapshot-hash',
      migrations: [],
    });
  });

  it('passes table filters into introspection', async () => {
    const { pullCommand } = await import('./pull.js');

    await pullCommand({ tables: 'events,users', excludeTables: 'users' });

    expect(introspectClickHouseSchema).toHaveBeenCalledWith(expect.objectContaining({
      includeTables: ['events', 'users'],
      excludeTables: ['users'],
    }));
  });

  it('refuses to overwrite an existing schema without force', async () => {
    await writeFile(path.join(tempDir, 'schema.ts'), 'existing', 'utf8');
    const { pullCommand } = await import('./pull.js');

    await expect(pullCommand()).rejects.toBeInstanceOf(ProcessExitError);

    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Baseline file already exists'));
  });

  it('refuses to overwrite existing migration metadata without force', async () => {
    const metaDir = path.join(tempDir, 'migrations', 'meta');
    await mkdir(metaDir, { recursive: true });
    await writeFile(path.join(metaDir, 'latest_snapshot.json'), '{}', 'utf8');
    const { pullCommand } = await import('./pull.js');

    await expect(pullCommand()).rejects.toBeInstanceOf(ProcessExitError);

    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('latest_snapshot.json'));
  });

  it('overwrites an existing schema with force', async () => {
    await writeFile(path.join(tempDir, 'schema.ts'), 'existing', 'utf8');
    const { pullCommand } = await import('./pull.js');

    await pullCommand({ force: true });

    await expect(readFile(path.join(tempDir, 'schema.ts'), 'utf8')).resolves.toContain('defineSchema');
  });
});

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
