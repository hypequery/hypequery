import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as detectDb from '../utils/detect-database.js';
import { mockProcessExit } from '../test-utils.js';

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
const mockGenerateDatasets = vi.hoisted(() => vi.fn());
const mockReadGeneratedFile = vi.hoisted(() => vi.fn());
const mockWriteGeneratedFileAtomically = vi.hoisted(() => vi.fn());
const mockFormatGeneratedFileDiff = vi.hoisted(() => vi.fn());

vi.mock('../utils/detect-database.js');
vi.mock('../utils/logger.js', () => ({
  logger: mockLogger,
}));
vi.mock('../generators/dataset-generator.js', () => ({
  generateDatasets: mockGenerateDatasets,
}));
vi.mock('../utils/generated-file.js', () => ({
  readGeneratedFile: mockReadGeneratedFile,
  writeGeneratedFileAtomically: mockWriteGeneratedFileAtomically,
}));
vi.mock('../utils/generated-file-diff.js', () => ({
  formatGeneratedFileDiff: mockFormatGeneratedFileDiff,
}));
vi.mock('ora', () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
  })),
}));

let generateDatasetsCommand: typeof import('./generate-datasets.js')['generateDatasetsCommand'];

describe('generate datasets command', () => {
  let exitHandler: ReturnType<typeof mockProcessExit>;

  beforeEach(async () => {
    vi.resetModules();
    ({ generateDatasetsCommand } = await import('./generate-datasets.js'));
    exitHandler = mockProcessExit();
    vi.clearAllMocks();
    vi.mocked(detectDb.getTableCount).mockResolvedValue(10);
    mockGenerateDatasets.mockResolvedValue({
      tables: ['orders'],
      exports: [{ table: 'orders', exportName: 'OrdersDataset' }],
      warnings: [],
      contents: 'generated datasets\n',
    });
    mockReadGeneratedFile.mockResolvedValue(undefined);
    mockWriteGeneratedFileAtomically.mockResolvedValue(undefined);
    mockFormatGeneratedFileDiff.mockReturnValue('--- datasets.ts\n+++ datasets.ts (generated)');
    process.exitCode = undefined;
  });

  afterEach(() => {
    exitHandler.restore();
    delete process.env.CLICKHOUSE_URL;
    process.exitCode = undefined;
  });

  it('derives datasets output from path when provided', async () => {
    await generateDatasetsCommand({ path: 'custom' });

    expect(mockGenerateDatasets).toHaveBeenCalledWith(
      expect.objectContaining({ outputPath: expect.stringContaining('custom/datasets.ts') }),
    );
  });

  it('prefers output over path', async () => {
    await generateDatasetsCommand({ output: 'explicit.ts', path: 'custom' });

    expect(mockGenerateDatasets).toHaveBeenCalledWith(
      expect.objectContaining({ outputPath: expect.stringContaining('explicit.ts') }),
    );
  });

  it('passes include and exclude table filters', async () => {
    await generateDatasetsCommand({
      path: 'custom',
      tables: 'orders, customers',
      excludeTables: 'orders_archive',
    });

    expect(mockGenerateDatasets).toHaveBeenCalledWith(
      expect.objectContaining({
        includeTables: ['orders', 'customers'],
        excludeTables: ['orders_archive'],
      }),
    );
  });

  it('forwards an explicit tenant column so regeneration keeps tenantKey', async () => {
    await generateDatasetsCommand({ path: 'analytics', tenantColumn: 'tenant_id' });

    expect(mockGenerateDatasets).toHaveBeenCalledWith(
      expect.objectContaining({ tenantColumn: 'tenant_id' }),
    );
  });

  it('leaves tenant isolation off when no tenant column is given', async () => {
    await generateDatasetsCommand({ path: 'analytics' });

    expect(mockGenerateDatasets).toHaveBeenCalledWith(
      expect.objectContaining({ tenantColumn: undefined }),
    );
  });

  it('defaults output to analytics/datasets.ts, beside generate\'s schema.ts', async () => {
    await generateDatasetsCommand({});

    expect(mockGenerateDatasets).toHaveBeenCalledWith(
      expect.objectContaining({ outputPath: expect.stringContaining('analytics/datasets.ts') }),
    );
  });

  it('reports the number of tables generated, not the number discovered', async () => {
    // 10 tables exist; only one is generated.
    mockGenerateDatasets.mockResolvedValue({
      tables: ['orders'],
      exports: [{ table: 'orders', exportName: 'OrdersDataset' }],
      warnings: [],
      contents: 'generated datasets\n',
    });

    await generateDatasetsCommand({ tables: 'orders' });

    expect(mockLogger.success).toHaveBeenCalledWith('Found 10 tables, filtering to 1');
  });

  it('prints an example that matches the file it wrote', async () => {
    mockGenerateDatasets.mockResolvedValue({
      tables: ['trips'],
      exports: [{ table: 'trips', exportName: 'TripsDataset' }],
      warnings: [],
      contents: 'generated trips\n',
    });

    await generateDatasetsCommand({ output: 'src/analytics/datasets.ts', tables: 'trips' });

    // Real import path, real table name — previously both were hardcoded to
    // './datasets/generated' and `datasets.orders`, neither of which existed.
    expect(mockLogger.indent).toHaveBeenCalledWith(
      "import { datasets } from './src/analytics/datasets';",
    );
    expect(mockLogger.indent).toHaveBeenCalledWith(
      "const rowCount = datasets['trips'].metric('rowCount', { measure: 'totalCount' });",
    );
  });

  it('surfaces tenant-key candidates without claiming they were enabled', async () => {
    mockGenerateDatasets.mockResolvedValue({
      tables: ['orders'],
      exports: [{ table: 'orders', exportName: 'OrdersDataset' }],
      warnings: [{
        kind: 'tenant-key-candidate',
        table: 'orders',
        columns: ['customer_id'],
        message: 'Review customer_id before enabling tenant scope.',
      }],
      contents: 'generated datasets\n',
    });

    await generateDatasetsCommand({ tables: 'orders' });

    expect(mockLogger.warn).toHaveBeenCalledWith('Review generated dataset tenant isolation:');
    expect(mockLogger.indent).toHaveBeenCalledWith(
      '• Review customer_id before enabling tenant scope.',
    );
  });

  it('redacts credentials from connection diagnostics', async () => {
    process.env.CLICKHOUSE_URL = 'https://admin:secret@clickhouse.example.com:8443/analytics?token=secret';
    vi.mocked(detectDb.getTableCount).mockRejectedValue(new Error('connect ECONNREFUSED'));

    await expect(generateDatasetsCommand({})).rejects.toThrow();

    expect(mockLogger.indent).toHaveBeenCalledWith(
      'CLICKHOUSE_URL=https://clickhouse.example.com:8443/analytics',
    );
    expect(mockLogger.indent).not.toHaveBeenCalledWith(expect.stringContaining('secret'));
  });

  it('renders first and atomically writes a new output file', async () => {
    await generateDatasetsCommand({ output: 'analytics/datasets.ts' });

    expect(mockGenerateDatasets).toHaveBeenCalledWith(expect.objectContaining({
      writeOutput: false,
    }));
    expect(mockWriteGeneratedFileAtomically).toHaveBeenCalledWith(
      expect.stringContaining('analytics/datasets.ts'),
      'generated datasets\n',
    );
  });

  it('refuses to replace an existing customized file by default', async () => {
    mockReadGeneratedFile.mockResolvedValue('customized datasets\n');

    await generateDatasetsCommand({ output: 'analytics/datasets.ts' });

    expect(mockWriteGeneratedFileAtomically).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Refusing to overwrite existing dataset definitions: analytics/datasets.ts',
    );
    expect(process.exitCode).toBe(1);
  });

  it('atomically replaces a changed file with --force', async () => {
    mockReadGeneratedFile.mockResolvedValue('old datasets\n');

    await generateDatasetsCommand({ output: 'analytics/datasets.ts', force: true });

    expect(mockWriteGeneratedFileAtomically).toHaveBeenCalledWith(
      expect.stringContaining('analytics/datasets.ts'),
      'generated datasets\n',
    );
    expect(mockLogger.success).toHaveBeenCalledWith('Updated analytics/datasets.ts');
    expect(process.exitCode).toBeUndefined();
  });

  it('does not rewrite an output file that is already current', async () => {
    mockReadGeneratedFile.mockResolvedValue('generated datasets\n');

    await generateDatasetsCommand({ output: 'analytics/datasets.ts' });

    expect(mockWriteGeneratedFileAtomically).not.toHaveBeenCalled();
    expect(mockLogger.success).toHaveBeenCalledWith('Unchanged analytics/datasets.ts');
  });

  it('supports a non-writing CI check', async () => {
    mockReadGeneratedFile.mockResolvedValue('old datasets\n');

    await generateDatasetsCommand({ output: 'analytics/datasets.ts', check: true });

    expect(mockWriteGeneratedFileAtomically).not.toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Generated dataset definitions are out of date: analytics/datasets.ts',
    );
    expect(process.exitCode).toBe(1);
  });

  it('passes a non-writing CI check when definitions are current', async () => {
    mockReadGeneratedFile.mockResolvedValue('generated datasets\n');

    await generateDatasetsCommand({ output: 'analytics/datasets.ts', check: true });

    expect(mockWriteGeneratedFileAtomically).not.toHaveBeenCalled();
    expect(mockLogger.success).toHaveBeenCalledWith(
      'Dataset definitions are up to date: analytics/datasets.ts',
    );
    expect(process.exitCode).toBeUndefined();
  });

  it('prints a non-writing diff and exits non-zero when regeneration differs', async () => {
    mockReadGeneratedFile.mockResolvedValue('old datasets\n');

    await generateDatasetsCommand({ output: 'analytics/datasets.ts', diff: true });

    expect(mockFormatGeneratedFileDiff).toHaveBeenCalledWith(
      'old datasets\n',
      'generated datasets\n',
      'analytics/datasets.ts',
    );
    expect(mockLogger.raw).toHaveBeenCalledWith('--- datasets.ts\n+++ datasets.ts (generated)');
    expect(mockWriteGeneratedFileAtomically).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('rejects force combined with non-writing modes', async () => {
    await generateDatasetsCommand({ force: true, check: true });

    expect(mockLogger.error).toHaveBeenCalledWith(
      '--force cannot be combined with --check or --diff.',
    );
    expect(mockGenerateDatasets).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
