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

const mockPrepareMigrationArtifacts = vi.hoisted(() => vi.fn());
const mockWriteMigrationArtifacts = vi.hoisted(() => vi.fn());

vi.mock('ora', () => ({
  default: vi.fn(() => mockSpinner),
}));

vi.mock('../utils/logger.js', () => ({
  logger: mockLogger,
}));

vi.mock('../utils/migration-state.js', () => ({
  prepareMigrationArtifacts: mockPrepareMigrationArtifacts,
}));

vi.mock('@hypequery/clickhouse', () => ({
  writeMigrationArtifacts: mockWriteMigrationArtifacts,
}));

describe('plan command', () => {
  let planCommand: typeof import('./plan.js')['planCommand'];
  let exitHandler: ReturnType<typeof mockProcessExit>;

  beforeEach(async () => {
    vi.resetModules();
    ({ planCommand } = await import('./plan.js'));
    exitHandler = mockProcessExit();
    vi.clearAllMocks();

    mockPrepareMigrationArtifacts.mockResolvedValue({
      metaDir: '/repo/migrations/meta',
      migrationName: '20260501120000_add_events',
      artifacts: {
        upSql: 'CREATE TABLE `events` ();',
        downSql: 'DROP TABLE `events`;',
        meta: { name: 'meta', timestamp: 'ts', operations: [], custom: false, unsafe: false, containsManualSteps: false },
        plan: { operations: [] },
      },
    });

    mockWriteMigrationArtifacts.mockResolvedValue({
      migrationDir: '/repo/migrations/meta/_plan/20260501120000_add_events',
      upPath: '',
      downPath: '',
      metaPath: '',
      planPath: '',
    });
  });

  afterEach(() => {
    exitHandler.restore();
  });

  it('writes preview artifacts under migrations/meta/_plan', async () => {
    await planCommand({ name: 'Add events' });

    expect(mockPrepareMigrationArtifacts).toHaveBeenCalledWith({ name: 'Add events' });
    expect(mockWriteMigrationArtifacts).toHaveBeenCalledWith(
      expect.objectContaining({
        outDir: '/repo/migrations/meta/_plan',
        migrationName: '20260501120000_add_events',
      }),
    );
    expect(mockLogger.callout).toHaveBeenCalledWith('Review Only', [
      'Journal state was not modified.',
      'This preview is safe to inspect or delete locally.',
    ]);
  });

  it('does not write preview artifacts when no changes exist', async () => {
    mockPrepareMigrationArtifacts.mockResolvedValue({
      metaDir: '/repo/migrations/meta',
      migrationName: '',
      artifacts: null,
    });

    await planCommand({ name: 'Noop' });

    expect(mockSpinner.succeed).toHaveBeenCalledWith('Schema is already up to date');
    expect(mockWriteMigrationArtifacts).not.toHaveBeenCalled();
  });

  it('reports planning failures clearly', async () => {
    mockPrepareMigrationArtifacts.mockRejectedValue(new Error('bad config'));

    await expect(planCommand({ name: 'Broken' })).rejects.toBeInstanceOf(ProcessExitError);
    expect(mockLogger.error).toHaveBeenCalledWith('bad config');
  });
});
