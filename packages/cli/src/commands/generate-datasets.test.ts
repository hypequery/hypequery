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

vi.mock('../utils/detect-database.js');
vi.mock('../utils/logger.js', () => ({
  logger: mockLogger,
}));
vi.mock('../generators/dataset-generator.js', () => ({
  generateDatasets: mockGenerateDatasets,
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
    mockGenerateDatasets.mockResolvedValue(undefined);
  });

  afterEach(() => {
    exitHandler.restore();
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
});
