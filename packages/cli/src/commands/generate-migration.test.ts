import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  column,
  defineSchema,
  defineTable,
  serializeSchemaToSnapshot,
  snapshotToStableJson,
  type ClickHouseSchemaAst,
} from '@hypequery/schema';
import { mockProcessExit, ProcessExitError } from '../test-utils.js';

type LoadModule = typeof import('../utils/load-api.js')['loadModule'];

vi.mock('../utils/load-api.js', () => ({
  loadModule: vi.fn(),
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
let loadModule: ReturnType<typeof vi.mocked<LoadModule>>;

describe('generate:migration command', () => {
  let previousCwd: string;
  let exitHandler: ReturnType<typeof mockProcessExit>;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    previousCwd = process.cwd();
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'hypequery-generate-migration-'));
    process.chdir(tempDir);
    exitHandler = mockProcessExit();

    ({ loadModule } = await import('../utils/load-api.js'));
  });

  afterEach(async () => {
    exitHandler.restore();
    process.chdir(previousCwd);
    await rm(tempDir, { recursive: true, force: true });
  });

  it('generates migration artifacts from a schema diff', async () => {
    mockConfigAndSchema(eventsSchema());

    const { generateMigrationCommand } = await import('./generate-migration.js');
    await generateMigrationCommand('add_events', { timestamp: '20260525120000' });

    const migrationDir = path.join(tempDir, 'migrations', '20260525120000_add_events');
    await expect(readFile(path.join(migrationDir, 'up.sql'), 'utf8')).resolves.toContain('CREATE TABLE `events`');
    await expect(readFile(path.join(migrationDir, 'down.sql'), 'utf8')).resolves.toContain('DROP TABLE `events`');
    await expect(readFile(path.join(migrationDir, 'snapshot.json'), 'utf8')).resolves.toContain('"events"');
    await expect(readFile(path.join(migrationDir, 'hypequery.sum'), 'utf8')).resolves.toContain('"algorithm": "sha256"');

    const meta = JSON.parse(await readFile(path.join(migrationDir, 'meta.json'), 'utf8'));
    expect(meta).toMatchObject({
      name: '20260525120000_add_events',
      custom: false,
      containsManualSteps: false,
    });

    const latestSnapshot = JSON.parse(
      await readFile(path.join(tempDir, 'migrations', 'meta', 'latest_snapshot.json'), 'utf8'),
    );
    expect(latestSnapshot.tables).toHaveLength(1);

    const journal = JSON.parse(
      await readFile(path.join(tempDir, 'migrations', 'meta', 'migrations.json'), 'utf8'),
    );
    expect(journal.migrations).toEqual([
      expect.objectContaining({
        name: '20260525120000_add_events',
        custom: false,
        checksum: expect.any(String),
      }),
    ]);
  });

  it('creates custom SQL migrations without advancing the latest snapshot', async () => {
    mockConfigAndSchema(eventsSchema());

    const { generateMigrationCommand } = await import('./generate-migration.js');
    await generateMigrationCommand('backfill_events', {
      custom: true,
      timestamp: '20260525120500',
    });

    const migrationDir = path.join(tempDir, 'migrations', '20260525120500_backfill_events');
    await expect(readFile(path.join(migrationDir, 'up.sql'), 'utf8')).resolves.toContain('custom migration SQL');
    await expect(readFile(path.join(migrationDir, 'hypequery.sum'), 'utf8')).resolves.toContain('"algorithm": "sha256"');

    const meta = JSON.parse(await readFile(path.join(migrationDir, 'meta.json'), 'utf8'));
    expect(meta).toMatchObject({
      custom: true,
      unsafe: true,
      containsManualSteps: true,
    });

    await expect(
      readFile(path.join(tempDir, 'migrations', 'meta', 'latest_snapshot.json'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('exits for invalid migration names', async () => {
    const { generateMigrationCommand } = await import('./generate-migration.js');

    await expect(generateMigrationCommand('../bad', { timestamp: '20260525120000' }))
      .rejects
      .toBeInstanceOf(ProcessExitError);

    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Invalid migration name'));
  });

  it('does not write migration files when the schema matches the latest snapshot', async () => {
    const schema = eventsSchema();
    mockConfigAndSchema(schema);
    await writeLatestSnapshotFixture(schema);

    const { generateMigrationCommand } = await import('./generate-migration.js');
    await generateMigrationCommand('noop', { timestamp: '20260525121000' });

    await expect(
      readFile(path.join(tempDir, 'migrations', '20260525121000_noop', 'up.sql'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(mockLogger.info).toHaveBeenCalledWith('No migration was generated.');
  });

  it('diffs against the latest saved snapshot for incremental migrations', async () => {
    await writeLatestSnapshotFixture(eventsSchema());
    mockConfigAndSchema(eventsSchemaWithNameColumn());

    const { generateMigrationCommand } = await import('./generate-migration.js');
    await generateMigrationCommand('add_event_name', { timestamp: '20260525121500' });

    const migrationDir = path.join(tempDir, 'migrations', '20260525121500_add_event_name');
    const upSql = await readFile(path.join(migrationDir, 'up.sql'), 'utf8');
    const meta = JSON.parse(await readFile(path.join(migrationDir, 'meta.json'), 'utf8'));

    expect(upSql).toContain('ALTER TABLE `events` ADD COLUMN `name` String');
    expect(upSql).not.toContain('CREATE TABLE `events`');
    expect(meta.operations).toEqual([
      expect.objectContaining({
        kind: 'AddColumn',
        classification: 'metadata',
      }),
    ]);
  });

  it('exits when the schema module does not export a schema', async () => {
    loadModule.mockImplementation(async (modulePath) => {
      if (modulePath === 'hypequery.config.ts') {
        return { default: configFixture() };
      }

      return { notSchema: true };
    });

    const { generateMigrationCommand } = await import('./generate-migration.js');
    await expect(generateMigrationCommand('bad_schema', { timestamp: '20260525122000' }))
      .rejects
      .toBeInstanceOf(ProcessExitError);

    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Invalid schema module'));
  });
});

function mockConfigAndSchema(schema: ClickHouseSchemaAst) {
  loadModule.mockImplementation(async (modulePath) => {
    if (modulePath === 'hypequery.config.ts') {
      return { default: configFixture() };
    }

    return { default: schema };
  });
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

async function writeLatestSnapshotFixture(schema: ClickHouseSchemaAst) {
  const snapshot = serializeSchemaToSnapshot(schema);
  const metaDir = path.join(tempDir, 'migrations', 'meta');
  await mkdir(metaDir, { recursive: true });
  await writeFile(
    path.join(metaDir, 'latest_snapshot.json'),
    `${snapshotToStableJson(snapshot)}\n`,
    'utf8',
  );
}

function eventsSchema() {
  return defineSchema({
    tables: [
      defineTable('events', {
        columns: {
          id: column.UUID(),
          created_at: column.DateTime(),
        },
        engine: {
          type: 'MergeTree',
          orderBy: ['created_at'],
        },
      }),
    ],
  });
}

function eventsSchemaWithNameColumn() {
  return defineSchema({
    tables: [
      defineTable('events', {
        columns: {
          id: column.UUID(),
          created_at: column.DateTime(),
          name: column.String(),
        },
        engine: {
          type: 'MergeTree',
          orderBy: ['created_at'],
        },
      }),
    ],
  });
}
