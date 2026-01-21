import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as findFiles from '../utils/find-files.js';
import * as detectDb from '../utils/detect-database.js';
import { mockProcessExit, ProcessExitError } from '../test-utils.js';
import ora from 'ora';

vi.mock('../utils/find-files.js');
vi.mock('../utils/detect-database.js');
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
const logger = mockLogger;
vi.mock('ora');

const mockGenerateTypes = vi.fn();
const mockGetTypeGenerator = vi.fn(() => mockGenerateTypes);
vi.mock('../generators/index.js', () => ({
  getTypeGenerator: mockGetTypeGenerator,
}));

let generateCommand: typeof import('./generate.js')['generateCommand'];

describe('generate command', () => {
  let exitHandler: ReturnType<typeof mockProcessExit>;
  let mockSpinner: any;

  beforeEach(async () => {
    vi.resetModules();
    ({ generateCommand } = await import('./generate.js'));

    exitHandler = mockProcessExit();
    vi.clearAllMocks();

    mockSpinner = {
      start: vi.fn().mockReturnThis(),
      succeed: vi.fn().mockReturnThis(),
      fail: vi.fn().mockReturnThis(),
      stop: vi.fn().mockReturnThis(),
    };
    vi.mocked(ora).mockReturnValue(mockSpinner);

    vi.mocked(findFiles.findSchemaFile).mockResolvedValue(null);
    vi.mocked(detectDb.getTableCount).mockResolvedValue(10);
    vi.mocked(detectDb.detectDatabase).mockResolvedValue('clickhouse');
    mockGenerateTypes.mockResolvedValue(undefined);

    process.env.CLICKHOUSE_HOST = 'localhost';
  });

  afterEach(() => {
    exitHandler.restore();
    delete process.env.CLICKHOUSE_HOST;
  });

  describe('Happy path', () => {
    it('generates types with default output path', async () => {
      await generateCommand({});

      expect(logger.header).toHaveBeenCalledWith('hypequery generate');
      expect(detectDb.getTableCount).toHaveBeenCalledWith('clickhouse');
      expect(mockSpinner.succeed).toHaveBeenCalledWith('Connected to ClickHouse');
      expect(logger.success).toHaveBeenCalledWith('Found 10 tables');
      expect(mockGenerateTypes).toHaveBeenCalledWith(
        expect.objectContaining({ outputPath: expect.stringContaining('analytics/schema.ts') })
      );
      expect(logger.header).toHaveBeenCalledWith('Types regenerated successfully!');
    });

    it('uses custom output path when provided', async () => {
      await generateCommand({ output: 'custom/schema.ts' });

      expect(mockGenerateTypes).toHaveBeenCalledWith(
        expect.objectContaining({ outputPath: expect.stringContaining('custom/schema.ts') })
      );
      expect(logger.success).toHaveBeenCalledWith(expect.stringContaining('custom/schema.ts'));
    });

    it('uses existing schema file when found', async () => {
      vi.mocked(findFiles.findSchemaFile).mockResolvedValue('/app/src/schema.ts');

      await generateCommand({});

      expect(mockGenerateTypes).toHaveBeenCalledWith(
        expect.objectContaining({ outputPath: '/app/src/schema.ts' })
      );
    });

    it('passes include tables when provided', async () => {
      await generateCommand({ tables: 'users, posts' });

      expect(mockGenerateTypes).toHaveBeenCalledWith(
        expect.objectContaining({ includeTables: ['users', 'posts'] })
      );
    });

    it('auto-detects database type', async () => {
      await generateCommand({});

      expect(detectDb.detectDatabase).toHaveBeenCalled();
      expect(mockGetTypeGenerator).toHaveBeenCalledWith('clickhouse');
    });

    it('displays correct table count', async () => {
      vi.mocked(detectDb.getTableCount).mockResolvedValue(25);

      await generateCommand({});

      expect(logger.success).toHaveBeenCalledWith('Found 25 tables');
      expect(mockSpinner.succeed).toHaveBeenCalledWith('Generated types for 25 tables');
    });

    it('handles zero tables', async () => {
      vi.mocked(detectDb.getTableCount).mockResolvedValue(0);

      await generateCommand({});

      expect(logger.success).toHaveBeenCalledWith('Found 0 tables');
      expect(mockSpinner.succeed).toHaveBeenCalledWith('Generated types for 0 tables');
    });
  });

  describe('Error paths', () => {
    it('handles database connection refused', async () => {
      const error = new Error('connect ECONNREFUSED 127.0.0.1:9000');
      vi.mocked(detectDb.getTableCount).mockRejectedValue(error);

      await expect(generateCommand({})).rejects.toBeInstanceOf(ProcessExitError);

      expect(mockSpinner.fail).toHaveBeenCalledWith('Failed to generate types');
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED'));
      expect(logger.info).toHaveBeenCalledWith('This usually means:');
      expect(logger.indent).toHaveBeenCalledWith('• ClickHouse is not running');
    });

    it('handles table generation errors', async () => {
      mockGenerateTypes.mockRejectedValue(new Error('Failed to write file'));

      await expect(generateCommand({})).rejects.toBeInstanceOf(ProcessExitError);

      expect(logger.error).toHaveBeenCalledWith('Failed to write file');
    });

    it('handles write permission errors', async () => {
      mockGenerateTypes.mockRejectedValue(new Error('EACCES: permission denied'));

      await expect(generateCommand({})).rejects.toBeInstanceOf(ProcessExitError);

      expect(logger.error).toHaveBeenCalledWith('EACCES: permission denied');
    });

    it('shows documentation link for connection errors', async () => {
      const error = new Error('connect ECONNREFUSED');
      vi.mocked(detectDb.getTableCount).mockRejectedValue(error);

      await expect(generateCommand({})).rejects.toBeInstanceOf(ProcessExitError);

      expect(logger.info).toHaveBeenCalledWith(
        'Docs: https://hypequery.com/docs/troubleshooting#connection-errors'
      );
    });

    it('handles connection timeouts', async () => {
      const error = new Error('Connection timeout');
      vi.mocked(detectDb.getTableCount).mockRejectedValue(error);

      await expect(generateCommand({})).rejects.toBeInstanceOf(ProcessExitError);

      expect(logger.error).toHaveBeenCalledWith('Connection timeout');
    });

    it('handles authentication errors', async () => {
      const error = new Error('Authentication failed: invalid credentials');
      vi.mocked(detectDb.getTableCount).mockRejectedValue(error);

      await expect(generateCommand({})).rejects.toBeInstanceOf(ProcessExitError);

      expect(logger.error).toHaveBeenCalledWith('Authentication failed: invalid credentials');
    });

    it('handles non-Error thrown values', async () => {
      // @ts-expect-error testing non-error rejection
      vi.mocked(detectDb.getTableCount).mockRejectedValue('string error');

      await expect(generateCommand({})).rejects.toBeInstanceOf(ProcessExitError);

      expect(logger.error).toHaveBeenCalledWith('string error');
    });

    it('handles unsupported databases', async () => {
      mockGetTypeGenerator.mockImplementationOnce(() => {
        throw new Error('unsupported');
      });

      vi.mocked(detectDb.detectDatabase).mockResolvedValue('bigquery');

      await expect(generateCommand({})).rejects.toBeInstanceOf(ProcessExitError);
      expect(logger.error).toHaveBeenCalledWith('unsupported');
    });
  });

  describe('Edge cases', () => {
    it('handles absolute output path', async () => {
      await generateCommand({ output: '/absolute/path/schema.ts' });

      expect(mockGenerateTypes).toHaveBeenCalledWith(
        expect.objectContaining({ outputPath: expect.stringContaining('/absolute/path/schema.ts') })
      );
    });

    it('handles relative output path', async () => {
      await generateCommand({ output: '../schema.ts' });

      expect(mockGenerateTypes).toHaveBeenCalledWith(
        expect.objectContaining({ outputPath: expect.stringContaining('schema.ts') })
      );
    });

    it('handles nested output path', async () => {
      await generateCommand({ output: 'deep/path/schema.ts' });

      expect(mockGenerateTypes).toHaveBeenCalledWith(
        expect.objectContaining({ outputPath: expect.stringContaining('deep/path/schema.ts') })
      );
    });

    it('prefers custom output over existing schema', async () => {
      vi.mocked(findFiles.findSchemaFile).mockResolvedValue('/existing/schema.ts');

      await generateCommand({ output: 'custom.ts' });

      expect(mockGenerateTypes).toHaveBeenCalledWith(
        expect.objectContaining({ outputPath: expect.stringContaining('custom.ts') })
      );
    });
  });
});
