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

const mockAccess = vi.hoisted(() => vi.fn());
const mockMkdir = vi.hoisted(() => vi.fn());
const mockWriteFile = vi.hoisted(() => vi.fn());
const mockLoadHypequeryConfig = vi.hoisted(() => vi.fn());
const mockCreateClient = vi.hoisted(() => vi.fn());
const mockSerializeSchemaToSnapshot = vi.hoisted(() => vi.fn());
const mockBuildPulledSchemaAst = vi.hoisted(() => vi.fn());
const mockRenderPulledSchemaSource = vi.hoisted(() => vi.fn());

vi.mock('ora', () => ({
  default: vi.fn(() => mockSpinner),
}));

vi.mock('../utils/logger.js', () => ({
  logger: mockLogger,
}));

vi.mock('node:fs/promises', () => ({
  access: mockAccess,
  mkdir: mockMkdir,
  writeFile: mockWriteFile,
}));

vi.mock('../utils/load-hypequery-config.js', () => ({
  loadHypequeryConfig: mockLoadHypequeryConfig,
}));

vi.mock('@clickhouse/client', () => ({
  createClient: mockCreateClient,
}));

vi.mock('@hypequery/clickhouse', async () => {
  const actual = await vi.importActual<typeof import('@hypequery/clickhouse')>('@hypequery/clickhouse');
  return {
    ...actual,
    buildPulledSchemaAst: mockBuildPulledSchemaAst,
    renderPulledSchemaSource: mockRenderPulledSchemaSource,
    serializeSchemaToSnapshot: mockSerializeSchemaToSnapshot,
    snapshotToStableJson: vi.fn((snapshot) => JSON.stringify(snapshot, null, 2)),
  };
});

describe('pull command', () => {
  let pullCommand: typeof import('./pull.js')['pullCommand'];
  let exitHandler: ReturnType<typeof mockProcessExit>;
  let queryMock: ReturnType<typeof vi.fn>;
  let closeMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    ({ pullCommand } = await import('./pull.js'));
    exitHandler = mockProcessExit();
    vi.clearAllMocks();

    mockLoadHypequeryConfig.mockResolvedValue({
      schema: './src/schema.ts',
      dbCredentials: {
        host: 'localhost',
        port: 8123,
        username: 'default',
        password: '',
        database: 'analytics',
      },
      migrations: {
        out: './migrations',
      },
    });

    mockAccess.mockRejectedValue(new Error('missing'));
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockBuildPulledSchemaAst.mockReturnValue({
      tables: [{ name: 'events' }],
    });
    mockRenderPulledSchemaSource.mockReturnValue(
      "import { defineSchema } from '@hypequery/clickhouse';\n\nexport const schema = defineSchema({ tables: [] });\n",
    );
    mockSerializeSchemaToSnapshot.mockReturnValue({
      contentHash: 'baseline-hash',
      tables: [{ name: 'events' }],
    });

    queryMock = vi.fn()
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue([
          {
            name: 'events',
            engine: 'MergeTree',
            partitionKey: 'toYYYYMM(created_at)',
            sortingKey: 'tenant_id, created_at',
            primaryKey: 'tenant_id, created_at',
            samplingKey: '',
          },
        ]),
      })
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue([
          {
            table: 'events',
            name: 'tenant_id',
            type: 'UInt64',
            defaultKind: null,
            defaultExpression: null,
            position: 1,
          },
          {
            table: 'events',
            name: 'created_at',
            type: "DateTime64(3, 'UTC')",
            defaultKind: 'DEFAULT',
            defaultExpression: 'now64()',
            position: 2,
          },
        ]),
      })
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue([{ count: 1 }]),
      });
    closeMock = vi.fn().mockResolvedValue(undefined);
    mockCreateClient.mockReturnValue({
      query: queryMock,
      close: closeMock,
    });
  });

  afterEach(() => {
    exitHandler.restore();
  });

  it('writes a baseline schema, snapshot, and journal from live ClickHouse metadata', async () => {
    await pullCommand({});

    expect(mockCreateClient).toHaveBeenCalledWith({
      url: 'http://localhost:8123',
      username: 'default',
      password: '',
      database: 'analytics',
    });
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('src/schema.ts'),
      expect.stringContaining("export const schema = defineSchema"),
      'utf8',
    );
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('migrations/meta/0000_snapshot.json'),
      expect.stringContaining('"contentHash": "baseline-hash"'),
      'utf8',
    );
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('migrations/meta/_journal.json'),
      expect.stringContaining('"latestSnapshotPath": "0000_snapshot.json"'),
      'utf8',
    );
    expect(mockLogger.callout).toHaveBeenCalledWith('Follow-up', [
      'Skipped 1 materialized view during baseline emission.',
      'Materialized view emission still requires a later manual follow-up step.',
    ]);
  });

  it('refuses to overwrite an existing baseline unless forced', async () => {
    mockAccess.mockResolvedValue(undefined);

    await expect(pullCommand({})).rejects.toBeInstanceOf(ProcessExitError);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Refusing to overwrite existing file'),
    );
  });

  it('allows overwrite when force is set', async () => {
    mockAccess.mockResolvedValue(undefined);

    await pullCommand({ force: true });

    expect(mockWriteFile).toHaveBeenCalled();
  });
});
